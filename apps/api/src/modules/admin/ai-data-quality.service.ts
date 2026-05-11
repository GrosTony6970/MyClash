import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type {
  GenerationRequest,
  GenerationResult,
} from '../ai-providers/adapters/provider-adapter.interface';
import { SupabaseService } from '../supabase/supabase.service';
import type { DataQualityFindingStatus } from './dto/data-quality.dto';
import { PlatformAISettingsService } from './platform-ai-settings.service';

type FindingType = 'global_person_duplicate' | 'club_duplicate' | 'referee_unlinked';
type FindingSeverity = 'low' | 'medium' | 'high' | 'critical';

type Candidate = {
  type: FindingType;
  severity: FindingSeverity;
  confidence: number;
  entityIds: Record<string, string[]>;
  evidence: Record<string, unknown>;
  fingerprint: string;
};

type AIRanking = {
  confidence: number;
  severity: FindingSeverity;
  explanation: string;
  recommendedAction: string;
};

const FALLBACK_AI_SUMMARY = 'AI summary unavailable.';

@Injectable()
export class AIDataQualityService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly platformAI: PlatformAISettingsService,
  ) {}

  async startScan(actorUserId: string): Promise<{
    scanId: string;
    candidateCount: number;
    findingCount: number;
  }> {
    const providerConfig = await this.platformAI.getProviderConfig();
    if (!providerConfig) {
      throw new BadRequestException('Super admin AI key is not configured');
    }

    const scan = await this.createScan(actorUserId);

    try {
      const [persons, clubs, refereeQualifications] = await Promise.all([
        this.loadGlobalPersons(),
        this.loadClubs(),
        this.loadRefereeQualifications(),
      ]);
      const candidates = [
        ...this.findGlobalPersonDuplicates(persons),
        ...this.findClubDuplicates(clubs),
        ...this.findUnlinkedReferees(refereeQualifications, persons),
      ];
      const findings = [];

      for (const candidate of candidates) {
        const { ranking, usage } = await this.rankCandidate(candidate);
        await this.logUsage(actorUserId, providerConfig.provider, usage);
        findings.push(this.toFindingRow(scan.id, candidate, ranking));
      }

      if (findings.length > 0) {
        await this.supabase.service
          .from('ai_data_quality_findings')
          .upsert(findings, { onConflict: 'fingerprint' });
      }

      await this.finishScan(scan.id, 'completed', candidates.length, findings.length);
      return { scanId: scan.id, candidateCount: candidates.length, findingCount: findings.length };
    } catch (error) {
      await this.failScan(scan.id, error instanceof Error ? error.message : 'Unknown scan error');
      throw error;
    }
  }

  async listScans() {
    const { data } = await this.supabase.service
      .from('ai_data_quality_scans')
      .select('*')
      .order('started_at', { ascending: false });
    return data ?? [];
  }

  async listFindings(
    filters: {
      status?: DataQualityFindingStatus;
      type?: string;
      severity?: string;
    } = {},
  ) {
    let query = this.supabase.service
      .from('ai_data_quality_findings')
      .select('*')
      .order('created_at', { ascending: false });

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.type) query = query.eq('finding_type', filters.type);
    if (filters.severity) query = query.eq('severity', filters.severity);

    const { data } = await query;
    return data ?? [];
  }

  async updateFindingStatus(
    findingId: string,
    status: DataQualityFindingStatus,
    reviewerUserId: string,
  ) {
    const { data, error } = await this.supabase.service
      .from('ai_data_quality_findings')
      .update({
        status,
        reviewed_by_user_id: reviewerUserId,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', findingId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  private async createScan(actorUserId: string): Promise<{ id: string }> {
    const { data, error } = await this.supabase.service
      .from('ai_data_quality_scans')
      .insert({
        actor_user_id: actorUserId,
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data as { id: string };
  }

  private async loadGlobalPersons(): Promise<GlobalPersonRow[]> {
    const { data } = await this.supabase.service
      .from('global_persons')
      .select(
        'id, given_name, family_name, display_name, hema_ratings_id, claimed_by_user_id, club_name, is_referee, merged_into_id, deleted_at',
      );
    return (data ?? []) as GlobalPersonRow[];
  }

  private async loadClubs(): Promise<ClubRow[]> {
    const { data } = await this.supabase.service
      .from('clubs')
      .select('id, name, abbreviation, city, country_code, verified, unverified');
    return (data ?? []) as ClubRow[];
  }

  private async loadRefereeQualifications(): Promise<RefereeQualificationRow[]> {
    const { data } = await this.supabase.service
      .from('referee_qualifications')
      .select('id, person_id, global_person_id, persons(given_name, family_name, display_name)');
    return (data ?? []) as RefereeQualificationRow[];
  }

  private findGlobalPersonDuplicates(persons: GlobalPersonRow[]): Candidate[] {
    const candidates: Candidate[] = [];
    for (let i = 0; i < persons.length; i += 1) {
      for (let j = i + 1; j < persons.length; j += 1) {
        const first = persons[i]!;
        const second = persons[j]!;
        const evidence = this.globalPersonDuplicateEvidence(first, second);
        if (!evidence) continue;
        candidates.push(
          this.candidate('global_person_duplicate', 'high', 0.86, {
            globalPersonIds: [first.id, second.id],
            evidence,
          }),
        );
      }
    }
    return candidates;
  }

  private globalPersonDuplicateEvidence(
    first: GlobalPersonRow,
    second: GlobalPersonRow,
  ): Record<string, unknown> | null {
    const reasons: string[] = [];
    if (samePresent(first.hema_ratings_id, second.hema_ratings_id)) {
      reasons.push('same_hema_ratings_id');
    }
    if (samePresent(first.claimed_by_user_id, second.claimed_by_user_id)) {
      reasons.push('same_claimed_user');
    }
    const firstName = normalizeName(personName(first));
    const secondName = normalizeName(personName(second));
    if (firstName && firstName === secondName) reasons.push('same_normalized_name');
    if (
      first.club_name &&
      second.club_name &&
      normalizeName(first.club_name) === normalizeName(second.club_name)
    ) {
      reasons.push('same_club_name');
    }

    if (reasons.length === 0) return null;
    return {
      reasons,
      persons: [this.safeGlobalPersonEvidence(first), this.safeGlobalPersonEvidence(second)],
    };
  }

  private findClubDuplicates(clubs: ClubRow[]): Candidate[] {
    const candidates: Candidate[] = [];
    for (let i = 0; i < clubs.length; i += 1) {
      for (let j = i + 1; j < clubs.length; j += 1) {
        const first = clubs[i]!;
        const second = clubs[j]!;
        const evidence = this.clubDuplicateEvidence(first, second);
        if (!evidence) continue;
        candidates.push(
          this.candidate('club_duplicate', 'medium', 0.78, {
            clubIds: [first.id, second.id],
            evidence,
          }),
        );
      }
    }
    return candidates;
  }

  private clubDuplicateEvidence(first: ClubRow, second: ClubRow): Record<string, unknown> | null {
    const reasons: string[] = [];
    if (samePresent(first.abbreviation, second.abbreviation)) {
      reasons.push('same_abbreviation');
    }
    if (normalizeName(first.name) === normalizeName(second.name)) {
      reasons.push('same_normalized_name');
    }
    if (
      first.city &&
      second.city &&
      first.country_code &&
      second.country_code &&
      normalizeName(first.city) === normalizeName(second.city) &&
      first.country_code.toUpperCase() === second.country_code.toUpperCase() &&
      similarity(normalizeName(first.name), normalizeName(second.name)) >= 0.86
    ) {
      reasons.push('same_city_country_similar_name');
    }

    if (reasons.length === 0) return null;
    return {
      reasons,
      clubs: [this.safeClubEvidence(first), this.safeClubEvidence(second)],
    };
  }

  private findUnlinkedReferees(
    qualifications: RefereeQualificationRow[],
    persons: GlobalPersonRow[],
  ): Candidate[] {
    const candidates: Candidate[] = [];
    const refereePersons = persons.filter((person) => person.is_referee);
    for (const qualification of qualifications) {
      if (qualification.global_person_id) continue;
      const name = normalizeName(personName(qualification.persons ?? {}));
      if (!name) continue;
      const matches = refereePersons.filter((person) => normalizeName(personName(person)) === name);
      if (matches.length === 0) continue;
      const match = matches[0]!;
      candidates.push(
        this.candidate('referee_unlinked', 'medium', 0.74, {
          refereeQualificationIds: [qualification.id],
          globalPersonIds: [match.id],
          evidence: {
            reasons: ['unlinked_referee_qualification_matches_global_referee_name'],
            qualification: {
              id: qualification.id,
              personId: qualification.person_id,
              displayName: personName(qualification.persons ?? {}),
            },
            globalPerson: this.safeGlobalPersonEvidence(match),
          },
        }),
      );
    }
    return candidates;
  }

  private async rankCandidate(candidate: Candidate): Promise<{
    ranking: AIRanking;
    usage: Pick<GenerationResult, 'inputTokens' | 'outputTokens' | 'costEur'>;
  }> {
    const request: GenerationRequest = {
      system:
        'You review MyClash platform data-quality candidates. Return strict JSON only with confidence, severity, explanation, and recommendedAction. Do not ask to auto-edit records.',
      user: JSON.stringify({
        type: candidate.type,
        deterministicConfidence: candidate.confidence,
        deterministicSeverity: candidate.severity,
        entityIds: candidate.entityIds,
        evidence: candidate.evidence,
      }),
      model: 'gpt-4o-mini',
      maxTokens: 500,
      temperature: 0.1,
    };

    const result = await this.platformAI.generate(request);
    return {
      ranking: this.parseAIRanking(result.text, candidate),
      usage: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costEur: result.costEur,
      },
    };
  }

  private parseAIRanking(text: string, candidate: Candidate): AIRanking {
    try {
      const parsed = JSON.parse(text) as Partial<AIRanking>;
      if (typeof parsed.explanation !== 'string' || typeof parsed.recommendedAction !== 'string') {
        throw new Error('Missing AI explanation');
      }
      return {
        confidence: clampConfidence(parsed.confidence ?? candidate.confidence),
        severity: isSeverity(parsed.severity) ? parsed.severity : candidate.severity,
        explanation: parsed.explanation,
        recommendedAction: parsed.recommendedAction,
      };
    } catch {
      return {
        confidence: candidate.confidence,
        severity: candidate.severity,
        explanation: FALLBACK_AI_SUMMARY,
        recommendedAction: 'Review deterministic evidence manually.',
      };
    }
  }

  private async logUsage(
    actorUserId: string,
    provider: string,
    usage: Pick<GenerationResult, 'inputTokens' | 'outputTokens' | 'costEur'>,
  ): Promise<void> {
    await this.supabase.service.from('platform_ai_usage_log').insert({
      actor_user_id: actorUserId,
      feature: 'super_admin_data_quality',
      provider,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cost_eur: usage.costEur,
      created_at: new Date().toISOString(),
    });
  }

  private toFindingRow(scanId: string, candidate: Candidate, ranking: AIRanking) {
    return {
      scan_id: scanId,
      finding_type: candidate.type,
      severity: ranking.severity,
      confidence: ranking.confidence,
      status: 'open',
      entity_ids: candidate.entityIds,
      evidence_json: candidate.evidence,
      ai_summary: ranking.explanation,
      recommended_action: ranking.recommendedAction,
      fingerprint: candidate.fingerprint,
      updated_at: new Date().toISOString(),
    };
  }

  private async finishScan(
    scanId: string,
    status: 'completed',
    candidateCount: number,
    findingCount: number,
  ): Promise<void> {
    await this.supabase.service
      .from('ai_data_quality_scans')
      .update({
        status,
        candidate_count: candidateCount,
        finding_count: findingCount,
        completed_at: new Date().toISOString(),
      })
      .eq('id', scanId);
  }

  private async failScan(scanId: string, errorMessage: string): Promise<void> {
    await this.supabase.service
      .from('ai_data_quality_scans')
      .update({
        status: 'failed',
        error_message: errorMessage,
        completed_at: new Date().toISOString(),
      })
      .eq('id', scanId);
  }

  private candidate(
    type: FindingType,
    severity: FindingSeverity,
    confidence: number,
    payload: {
      globalPersonIds?: string[];
      clubIds?: string[];
      refereeQualificationIds?: string[];
      evidence: Record<string, unknown>;
    },
  ): Candidate {
    const entityIds = {
      ...(payload.globalPersonIds ? { globalPersonIds: payload.globalPersonIds } : {}),
      ...(payload.clubIds ? { clubIds: payload.clubIds } : {}),
      ...(payload.refereeQualificationIds
        ? { refereeQualificationIds: payload.refereeQualificationIds }
        : {}),
    };
    return {
      type,
      severity,
      confidence,
      entityIds,
      evidence: payload.evidence,
      fingerprint: fingerprint(type, entityIds),
    };
  }

  private safeGlobalPersonEvidence(person: GlobalPersonRow) {
    return {
      id: person.id,
      displayName: person.display_name ?? personName(person),
      hemaRatingsId: person.hema_ratings_id ?? null,
      clubName: person.club_name ?? null,
      claimed: Boolean(person.claimed_by_user_id),
      referee: Boolean(person.is_referee),
      mergedIntoId: person.merged_into_id ?? null,
      deletedAt: person.deleted_at ?? null,
    };
  }

  private safeClubEvidence(club: ClubRow) {
    return {
      id: club.id,
      name: club.name,
      abbreviation: club.abbreviation ?? null,
      city: club.city ?? null,
      countryCode: club.country_code ?? null,
      verified: Boolean(club.verified),
      unverified: Boolean(club.unverified),
    };
  }
}

type GlobalPersonRow = {
  id: string;
  given_name?: string | null;
  family_name?: string | null;
  display_name?: string | null;
  hema_ratings_id?: string | null;
  claimed_by_user_id?: string | null;
  club_name?: string | null;
  is_referee?: boolean | null;
  merged_into_id?: string | null;
  deleted_at?: string | null;
};

type ClubRow = {
  id: string;
  name: string;
  abbreviation?: string | null;
  city?: string | null;
  country_code?: string | null;
  verified?: boolean | null;
  unverified?: boolean | null;
};

type RefereeQualificationRow = {
  id: string;
  person_id?: string | null;
  global_person_id?: string | null;
  persons?: {
    given_name?: string | null;
    family_name?: string | null;
    display_name?: string | null;
  } | null;
};

function personName(person: {
  given_name?: string | null;
  family_name?: string | null;
  display_name?: string | null;
}): string {
  return person.display_name ?? [person.given_name, person.family_name].filter(Boolean).join(' ');
}

function normalizeName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function samePresent(first: string | null | undefined, second: string | null | undefined): boolean {
  if (!first || !second) return false;
  return normalizeName(first) === normalizeName(second);
}

function similarity(first: string, second: string): number {
  if (!first || !second) return 0;
  if (first === second) return 1;
  const firstTokens = new Set(first.split(' '));
  const secondTokens = new Set(second.split(' '));
  const intersection = [...firstTokens].filter((token) => secondTokens.has(token)).length;
  const union = new Set([...firstTokens, ...secondTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

function fingerprint(type: FindingType, entityIds: Record<string, string[]>): string {
  const stableIds = Object.entries(entityIds)
    .map(([key, ids]) => `${key}:${[...ids].sort().join(',')}`)
    .sort()
    .join('|');
  return createHash('sha256').update(`${type}:${stableIds}`).digest('hex');
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function isSeverity(value: unknown): value is FindingSeverity {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'critical';
}
