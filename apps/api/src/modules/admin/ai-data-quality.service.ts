import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';
import type {
  GenerationRequest,
  GenerationResult,
} from '../ai-providers/adapters/provider-adapter.interface';
import { SupabaseService } from '../supabase/supabase.service';
import { AdminFeatureFlagsService } from './admin-feature-flags.service';
import type { DataQualityFindingStatus } from './dto/data-quality.dto';
import { PlatformAISettingsService } from './platform-ai-settings.service';

type FindingType =
  | 'global_person_duplicate'
  | 'club_duplicate'
  | 'referee_unlinked'
  | 'identity_gap'
  | 'placeholder_name'
  | 'event_person_duplicate'
  | 'missing_field';
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

/**
 * Cap how many candidates we feed to the LLM ranker. The deterministic
 * scan ignores this cap (it doesn't cost per call). With 5 finder
 * methods we can produce >100 candidates on noisy data; this prevents
 * a runaway bill on the AI path while still surfacing the most-
 * obvious cleanup work in the same scan.
 */
const AI_RANK_CAP = 100;

/**
 * Detect names that look like seed / test / demo records left behind
 * after a manual import or development run. Returns the rule that
 * matched so the operator can spot false positives quickly.
 *
 * Exported at module scope so the rule chain is unit-testable
 * independently of the supabase mocks the service tests need.
 */
const PLACEHOLDER_EXACT = new Set([
  'test',
  'tests',
  'testing',
  'demo',
  'sample',
  'example',
  'todo',
  'tbd',
  'n/a',
  'na',
  'xxx',
  'yyy',
  'zzz',
  'asdf',
  'qwerty',
  'placeholder',
  'dummy',
  'foo',
  'bar',
  'baz',
  'lorem',
  'ipsum',
  'temp',
  'temporary',
]);

const PLACEHOLDER_PATTERNS: Array<{ rule: string; regex: RegExp }> = [
  { rule: 'test_with_number', regex: /^test[\s_-]?\d+$/ },
  { rule: 'placeholder_prefix', regex: /^(test|demo|sample|placeholder|dummy)[\s_-].+/ },
  { rule: 'placeholder_suffix', regex: /^.+?[\s_-](test|demo|sample|placeholder|dummy)$/ },
];

export function detectPlaceholderName(value: string | null | undefined): {
  matched: boolean;
  rule?: string;
} {
  if (!value) return { matched: false };
  const lower = value.trim().toLowerCase();
  if (!lower) return { matched: false };

  if (PLACEHOLDER_EXACT.has(lower)) return { matched: true, rule: `exact:${lower}` };

  for (const { rule, regex } of PLACEHOLDER_PATTERNS) {
    if (regex.test(lower)) return { matched: true, rule };
  }

  // 80%+ same-letter density on 5+ char alpha-only names (catches
  // `aaaaa`, `aaaaab`, etc.). Skipped for short or punctuated values
  // so initials like "A.B.C." don't trip the heuristic.
  if (lower.length >= 5 && /^[a-z]+$/.test(lower)) {
    const freq = new Map<string, number>();
    for (const ch of lower) freq.set(ch, (freq.get(ch) ?? 0) + 1);
    const maxFreq = Math.max(...freq.values());
    if (maxFreq / lower.length >= 0.8) return { matched: true, rule: 'high_letter_density' };
  }

  return { matched: false };
}

@Injectable()
export class AIDataQualityService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly platformAI: PlatformAISettingsService,
    private readonly flags: AdminFeatureFlagsService,
  ) {}

  async startScan(actorUserId: string): Promise<{
    scanId: string;
    candidateCount: number;
    findingCount: number;
  }> {
    if (await this.flags.isEnabled('disable_ai_features')) {
      throw new ServiceUnavailableException('AI features are temporarily disabled');
    }
    const providerConfig = await this.platformAI.getProviderConfig();
    if (!providerConfig) {
      throw new BadRequestException('Super admin AI key is not configured');
    }

    const scan = await this.createScan(actorUserId);

    try {
      const candidates = (await this.collectAllCandidates()).slice(0, AI_RANK_CAP);
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

  /**
   * Run the same finder battery as `startScan` but skip the LLM
   * ranker — persist each candidate verbatim with `confidence: 1.0`
   * and a synthesized summary. Cheap enough to run unattended on a
   * daily cron; the operator gets a stable baseline before any
   * AI-assisted review.
   */
  async runDeterministicScan(actorUserId: string): Promise<{
    scanId: string;
    candidateCount: number;
    findingCount: number;
  }> {
    const scan = await this.createScan(actorUserId);
    try {
      const candidates = await this.collectAllCandidates();
      const findings = candidates.map((candidate) =>
        this.toDeterministicFindingRow(scan.id, candidate),
      );

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

  /**
   * Fan out all five finders and concat. Shared between the AI and
   * deterministic paths so the rules stay in one place. Loads are
   * parallelised to keep the daily cron under a couple of seconds.
   */
  private async collectAllCandidates(): Promise<Candidate[]> {
    const [persons, clubs, refereeQualifications, eventPersons, registrations] = await Promise.all([
      this.loadGlobalPersons(),
      this.loadClubs(),
      this.loadRefereeQualifications(),
      this.loadEventPersons(),
      this.loadRegistrations(),
    ]);
    return [
      ...this.findGlobalPersonDuplicates(persons),
      ...this.findClubDuplicates(clubs),
      ...this.findUnlinkedReferees(refereeQualifications, persons),
      ...this.findIdentityGaps(persons, eventPersons, refereeQualifications, registrations),
      ...this.findPlaceholderNames(persons, eventPersons, clubs),
      ...this.findEventPersonDuplicates(eventPersons),
      ...this.findMissingFields(eventPersons),
    ];
  }

  async listScans() {
    const { data, error } = await this.supabase.service
      .from('ai_data_quality_scans')
      .select('*')
      .order('started_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
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

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
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
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .select(
        'id, given_name, family_name, display_name, hema_ratings_id, claimed_by_user_id, club_name, is_referee, merged_into_id, deleted_at',
      );
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as GlobalPersonRow[];
  }

  private async loadClubs(): Promise<ClubRow[]> {
    const { data, error } = await this.supabase.service
      .from('clubs')
      .select('id, name, abbreviation, city, country_code, verified, unverified');
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as ClubRow[];
  }

  private async loadRefereeQualifications(): Promise<RefereeQualificationRow[]> {
    // Post-0063: referee_qualifications.person_id → global_persons. The legacy
    // `global_person_id` column (added in 0023) is now redundant — kept for
    // backwards compatibility with the findUnlinkedReferees heuristic, but
    // unused in greenfield data.
    const { data, error } = await this.supabase.service
      .from('referee_qualifications')
      .select(
        'id, person_id, global_person_id, global_persons(given_name, family_name, display_name)',
      );
    if (error) throw new BadRequestException(error.message);
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
      const name = normalizeName(personName(qualification.global_persons ?? {}));
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
              displayName: personName(qualification.global_persons ?? {}),
            },
            globalPerson: this.safeGlobalPersonEvidence(match),
          },
        }),
      );
    }
    return candidates;
  }

  /**
   * Identity-gap surface — four sub-codes (see plan). Each gap is a
   * standalone finding so the operator can resolve them one by one.
   * "Unlinked referee qualification" is already covered by
   * `findUnlinkedReferees` so it's intentionally not duplicated here.
   */
  private findIdentityGaps(
    persons: GlobalPersonRow[],
    eventPersons: EventPersonRow[],
    refereeQualifications: RefereeQualificationRow[],
    registrations: RegistrationRow[],
  ): Candidate[] {
    const candidates: Candidate[] = [];

    const referencedByEventPersons = new Set(
      eventPersons.map((p) => p.global_person_id).filter((id): id is string => Boolean(id)),
    );
    const referencedByRefereeQuals = new Set(
      refereeQualifications.map((q) => q.person_id).filter((id): id is string => Boolean(id)),
    );
    const referencedByRegistrations = new Set(
      registrations.map((r) => r.fighter_id).filter((id): id is string => Boolean(id)),
    );

    for (const person of persons) {
      if (person.deleted_at || person.merged_into_id) continue;

      if (
        !referencedByEventPersons.has(person.id) &&
        !referencedByRefereeQuals.has(person.id) &&
        !referencedByRegistrations.has(person.id)
      ) {
        candidates.push(
          this.candidate('identity_gap', 'low', 1.0, {
            globalPersonIds: [person.id],
            evidence: {
              gap_code: 'global_person_no_links',
              globalPerson: this.safeGlobalPersonEvidence(person),
            },
          }),
        );
      }

      if (person.is_referee && !referencedByRefereeQuals.has(person.id)) {
        candidates.push(
          this.candidate('identity_gap', 'low', 1.0, {
            globalPersonIds: [person.id],
            evidence: {
              gap_code: 'referee_flag_no_qualifications',
              globalPerson: this.safeGlobalPersonEvidence(person),
            },
          }),
        );
      }
    }

    for (const ep of eventPersons) {
      if (ep.global_person_id) continue;
      candidates.push(
        this.candidate('identity_gap', 'medium', 1.0, {
          personIds: [ep.id],
          evidence: {
            gap_code: 'persons_unlinked',
            person: {
              id: ep.id,
              event_id: ep.event_id,
              given_name: ep.given_name ?? null,
              family_name: ep.family_name ?? null,
            },
          },
        }),
      );
    }

    return candidates;
  }

  /**
   * Placeholder-name surface — flags global_persons, event-scoped
   * persons, and clubs whose display name looks like a stub (e.g.
   * `test`, `test fighter`, `demo club`, `aaaaaa`). See
   * `detectPlaceholderName` for the rule chain.
   */
  private findPlaceholderNames(
    persons: GlobalPersonRow[],
    eventPersons: EventPersonRow[],
    clubs: ClubRow[],
  ): Candidate[] {
    const candidates: Candidate[] = [];

    for (const person of persons) {
      if (person.deleted_at || person.merged_into_id) continue;
      const display = person.display_name ?? personName(person);
      const hit = detectPlaceholderName(display);
      if (!hit.matched) continue;
      candidates.push(
        this.candidate('placeholder_name', 'medium', 1.0, {
          globalPersonIds: [person.id],
          evidence: {
            entity_kind: 'global_person',
            entity_table: 'global_persons',
            name: display,
            matched_rule: hit.rule,
          },
        }),
      );
    }

    for (const ep of eventPersons) {
      const composed = `${ep.given_name ?? ''} ${ep.family_name ?? ''}`.trim();
      const hit = detectPlaceholderName(composed);
      if (!hit.matched) continue;
      candidates.push(
        this.candidate('placeholder_name', 'medium', 1.0, {
          personIds: [ep.id],
          evidence: {
            entity_kind: 'person',
            entity_table: 'persons',
            name: composed,
            matched_rule: hit.rule,
          },
        }),
      );
    }

    for (const club of clubs) {
      const hit = detectPlaceholderName(club.name);
      if (!hit.matched) continue;
      candidates.push(
        this.candidate('placeholder_name', 'medium', 1.0, {
          clubIds: [club.id],
          evidence: {
            entity_kind: 'club',
            entity_table: 'clubs',
            name: club.name,
            matched_rule: hit.rule,
          },
        }),
      );
    }

    return candidates;
  }

  /**
   * Same-event duplicates on event-scoped `persons` rows. Catches the
   * shape the operator sees when they create two participants with the
   * same name inside one event — the global_persons finder misses this
   * because the resolver either linked both to one global row (no
   * duplicate to detect there) or to two separate global rows with
   * subtly different identifiers (rating id, club name).
   */
  private findEventPersonDuplicates(eventPersons: EventPersonRow[]): Candidate[] {
    const candidates: Candidate[] = [];
    const byEvent = new Map<string, EventPersonRow[]>();
    for (const ep of eventPersons) {
      const list = byEvent.get(ep.event_id) ?? [];
      list.push(ep);
      byEvent.set(ep.event_id, list);
    }
    for (const [eventId, rows] of byEvent) {
      for (let i = 0; i < rows.length; i += 1) {
        for (let j = i + 1; j < rows.length; j += 1) {
          const a = rows[i]!;
          const b = rows[j]!;
          const aName = normalizeName(`${a.given_name ?? ''} ${a.family_name ?? ''}`);
          const bName = normalizeName(`${b.given_name ?? ''} ${b.family_name ?? ''}`);
          if (!aName || aName !== bName) continue;
          candidates.push(
            this.candidate('event_person_duplicate', 'medium', 1.0, {
              personIds: [a.id, b.id],
              evidence: {
                event_id: eventId,
                reasons: ['same_normalized_name_in_event'],
                persons: [
                  {
                    id: a.id,
                    given_name: a.given_name ?? null,
                    family_name: a.family_name ?? null,
                    club_id: a.club_id ?? null,
                  },
                  {
                    id: b.id,
                    given_name: b.given_name ?? null,
                    family_name: b.family_name ?? null,
                    club_id: b.club_id ?? null,
                  },
                ],
              },
            }),
          );
        }
      }
    }
    return candidates;
  }

  /**
   * Required-field gaps on event-scoped `persons` rows. One finding per
   * row even when several fields are missing — the evidence carries the
   * full list so the operator triages by row, not by field.
   */
  private findMissingFields(eventPersons: EventPersonRow[]): Candidate[] {
    const candidates: Candidate[] = [];
    for (const ep of eventPersons) {
      const missing: string[] = [];
      if (!ep.club_id) missing.push('club_id');
      if (!ep.given_name || !ep.given_name.trim()) missing.push('given_name');
      if (!ep.family_name || !ep.family_name.trim()) missing.push('family_name');
      if (missing.length === 0) continue;
      candidates.push(
        this.candidate('missing_field', 'low', 1.0, {
          personIds: [ep.id],
          evidence: {
            missing_fields: missing,
            person: {
              id: ep.id,
              event_id: ep.event_id,
              given_name: ep.given_name ?? null,
              family_name: ep.family_name ?? null,
              club_id: ep.club_id ?? null,
            },
          },
        }),
      );
    }
    return candidates;
  }

  private async loadEventPersons(): Promise<EventPersonRow[]> {
    const { data, error } = await this.supabase.service
      .from('persons')
      .select('id, event_id, given_name, family_name, global_person_id, club_id');
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as EventPersonRow[];
  }

  private async loadRegistrations(): Promise<RegistrationRow[]> {
    // Identity now flows through person_id → persons.global_person_id;
    // the legacy registrations.fighter_id column was retired in 0083.
    const { data, error } = await this.supabase.service
      .from('registrations')
      .select('id, persons!inner(global_person_id)');
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as Array<{
      id: string;
      persons: { global_person_id: string | null } | { global_person_id: string | null }[] | null;
    }>;
    return rows.map((r) => {
      const link = Array.isArray(r.persons) ? r.persons[0] : r.persons;
      return { id: r.id, fighter_id: link?.global_person_id ?? null };
    });
  }

  /**
   * Build a finding row directly from a candidate, with confidence
   * pinned at 1.0 (deterministic) and a synthesized summary instead
   * of an LLM-generated one.
   */
  private toDeterministicFindingRow(scanId: string, candidate: Candidate) {
    return {
      scan_id: scanId,
      finding_type: candidate.type,
      severity: candidate.severity,
      confidence: 1.0,
      status: 'open',
      entity_ids: candidate.entityIds,
      evidence_json: candidate.evidence,
      ai_summary: synthesizeSummary(candidate),
      recommended_action: deterministicAction(candidate),
      fingerprint: candidate.fingerprint,
      updated_at: new Date().toISOString(),
    };
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
      personIds?: string[];
      evidence: Record<string, unknown>;
    },
  ): Candidate {
    const entityIds = {
      ...(payload.globalPersonIds ? { globalPersonIds: payload.globalPersonIds } : {}),
      ...(payload.clubIds ? { clubIds: payload.clubIds } : {}),
      ...(payload.refereeQualificationIds
        ? { refereeQualificationIds: payload.refereeQualificationIds }
        : {}),
      ...(payload.personIds ? { personIds: payload.personIds } : {}),
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
  /** Post-0063: name resolved via global_persons (person_id → global_persons.id). */
  global_persons?: {
    given_name?: string | null;
    family_name?: string | null;
    display_name?: string | null;
  } | null;
};

type EventPersonRow = {
  id: string;
  event_id: string;
  given_name?: string | null;
  family_name?: string | null;
  global_person_id?: string | null;
  club_id?: string | null;
};

type RegistrationRow = {
  id: string;
  fighter_id?: string | null;
};

function synthesizeSummary(candidate: Candidate): string {
  const evidence = candidate.evidence as Record<string, unknown>;
  switch (candidate.type) {
    case 'global_person_duplicate': {
      const reasons = (evidence['reasons'] as string[] | undefined) ?? [];
      return reasons.length > 0
        ? `Two global profiles match on ${reasons.join(', ')} — consider merging.`
        : 'Two global profiles look like duplicates — consider merging.';
    }
    case 'club_duplicate': {
      const reasons = (evidence['reasons'] as string[] | undefined) ?? [];
      return reasons.length > 0
        ? `Clubs share ${reasons.join(', ')} — consider consolidating.`
        : 'Two clubs look like duplicates — consider consolidating.';
    }
    case 'referee_unlinked':
      return 'Referee qualification has no global identity link — consider linking the matching global profile.';
    case 'identity_gap': {
      const code = (evidence['gap_code'] as string | undefined) ?? 'unknown';
      switch (code) {
        case 'global_person_no_links':
          return 'Global profile has no participant, registration, or qualification references.';
        case 'persons_unlinked':
          return 'Event participant has no global identity link.';
        case 'referee_flag_no_qualifications':
          return 'Profile is marked as referee but has no qualifications.';
        default:
          return 'Identity gap detected — review the linked records.';
      }
    }
    case 'placeholder_name': {
      const kind = (evidence['entity_kind'] as string | undefined) ?? 'record';
      const name = (evidence['name'] as string | undefined) ?? '(empty)';
      const rule = (evidence['matched_rule'] as string | undefined) ?? 'placeholder';
      return `${kind} named '${name}' looks like a placeholder (${rule}) — consider deleting or renaming.`;
    }
    case 'event_person_duplicate': {
      const reasons = (evidence['reasons'] as string[] | undefined) ?? [];
      return reasons.length > 0
        ? `Two event participants share ${reasons.join(', ')} — likely duplicate registrations.`
        : 'Two event participants look like duplicates — consider merging or removing one.';
    }
    case 'missing_field': {
      const missing = (evidence['missing_fields'] as string[] | undefined) ?? [];
      return missing.length > 0
        ? `Participant is missing required field(s): ${missing.join(', ')}.`
        : 'Participant has missing required fields.';
    }
  }
}

function deterministicAction(candidate: Candidate): string {
  switch (candidate.type) {
    case 'global_person_duplicate':
    case 'club_duplicate':
    case 'event_person_duplicate':
      return 'merge';
    case 'referee_unlinked':
      return 'link_global_person';
    case 'identity_gap':
      return 'review';
    case 'placeholder_name':
      return 'delete_or_rename';
    case 'missing_field':
      return 'fill_required_fields';
  }
}

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
