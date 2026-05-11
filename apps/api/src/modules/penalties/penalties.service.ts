import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import {
  computeDirectPenaltySanction,
  computePenaltySanction,
  parsePenaltyRulesetCsv,
  type ExistingPenaltyForSanction,
  type PenaltyCard,
  type PenaltyRulesetEntry,
} from '@myclash/rulesets';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SupabaseService } from '../supabase/supabase.service';
import { ScoringService } from '../matches/scoring.service';
import { FrozenResultsGuard } from '../matches/frozen-results.guard';
import { MatchForfeitsService } from '../matches/match-forfeits.service';
import { OrganizationsService } from '../organizations/organizations.service';
import type {
  AssignPenaltyRulesetDto,
  CreatePenaltyDto,
  CreatePenaltyRulesetDto,
  ImportPenaltyRulesetCsvDto,
  ReviewPenaltyDto,
  VoidPenaltyDto,
} from './dto/penalties.dto';

type Row = Record<string, unknown>;

const BUILTIN_CODE = 'ffamhe_tf_2026';
const BUILTIN_VERSION = '2026';
const BUILTIN_NAME = 'Penalty - Tournois fédéraux FFAMHE';

@Injectable()
export class PenaltiesService {
  private readonly logger = new Logger(PenaltiesService.name);

  constructor(
    private readonly supabase: SupabaseService,
    @Optional() private readonly scoring?: ScoringService,
    @Optional() private readonly frozenResults?: FrozenResultsGuard,
    @Optional() private readonly orgs?: OrganizationsService,
    @Optional() private readonly forfeits?: MatchForfeitsService,
  ) {}

  async listRulesets() {
    await this.ensureBuiltInRuleset();
    const { data, error } = await this.supabase.service
      .from('penalty_rulesets')
      .select('*')
      .order('built_in', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async getRuleset(rulesetId: string) {
    await this.ensureBuiltInRuleset();
    const { data, error } = await this.supabase.service
      .from('penalty_rulesets')
      .select('*, penalty_ruleset_entries(*)')
      .eq('id', rulesetId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Penalty ruleset ${rulesetId} not found`);
    return data;
  }

  async getEffectiveRulesetForMatch(matchId: string) {
    const match = await this.getMatchContext(matchId);
    if (match.penaltyRulesetId) return this.getRuleset(match.penaltyRulesetId);

    await this.ensureBuiltInRuleset();
    const { data, error } = await this.supabase.service
      .from('penalty_rulesets')
      .select('*, penalty_ruleset_entries(*)')
      .eq('code', BUILTIN_CODE)
      .eq('version', BUILTIN_VERSION)
      .is('owner_organization_id', null)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async createRuleset(dto: CreatePenaltyRulesetDto, userId?: string) {
    await this.assertUserCanManageOrg(dto.ownerOrganizationId, userId);
    const { data, error } = await this.supabase.service
      .from('penalty_rulesets')
      .insert({
        owner_organization_id: dto.ownerOrganizationId,
        code: dto.code,
        version: dto.version,
        name: dto.name.trim(),
        description: dto.description ?? null,
        accumulation_scope: dto.accumulationScope,
        public_visibility: dto.publicVisibility,
        built_in: false,
        created_by_user_id: userId ?? null,
      })
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    const ruleset = data as Row;
    await this.replaceEntries(ruleset['id'] as string, dto.entries);
    return this.getRuleset(ruleset['id'] as string);
  }

  async importRulesetCsv(dto: ImportPenaltyRulesetCsvDto, userId?: string) {
    const ownerOrganizationId =
      dto.ownerOrganizationId ??
      (dto.eventId ? await this.getEventOrganizationId(dto.eventId) : null);
    if (!ownerOrganizationId) {
      throw new BadRequestException('ownerOrganizationId or eventId is required');
    }
    const parsed = parsePenaltyRulesetCsv(dto.csv, {
      code: dto.code,
      name: dto.name,
      version: dto.version,
      accumulationScope: dto.accumulationScope,
      builtIn: false,
    });
    return this.createRuleset(
      {
        ownerOrganizationId,
        code: parsed.code,
        version: parsed.version,
        name: parsed.name,
        accumulationScope: parsed.accumulationScope,
        publicVisibility: false,
        entries: parsed.entries.map((entry) => ({
          groupNumber: entry.groupNumber,
          refNumber: entry.refNumber,
          shortName: entry.shortName,
          description: entry.description,
          sanctions: [...entry.sanctions],
        })),
      },
      userId,
    );
  }

  async assignEventRuleset(eventId: string, dto: AssignPenaltyRulesetDto, userId?: string) {
    await this.assertUserCanManageOrg(await this.getEventOrganizationId(eventId), userId);
    const { data, error } = await this.supabase.service
      .from('events')
      .update({
        penalty_ruleset_id: dto.penaltyRulesetId ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', eventId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async assignTournamentRuleset(
    tournamentId: string,
    dto: AssignPenaltyRulesetDto,
    userId?: string,
  ) {
    await this.assertUserCanManageOrg(await this.getTournamentOrganizationId(tournamentId), userId);
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .update({
        penalty_ruleset_id: dto.penaltyRulesetId ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', tournamentId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async listMatchPenalties(matchId: string) {
    const { data, error } = await this.supabase.service
      .from('match_penalties')
      .select('*')
      .eq('match_id', matchId)
      .order('sequence', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createPenalty(
    matchId: string,
    dto: CreatePenaltyDto,
    context?: { userId?: string; staffAccountId?: string; canOverrideLocked?: boolean },
  ) {
    const match = await this.getMatchContext(matchId);
    this.assertMatchNotLocked(match, context);
    if (!context?.staffAccountId) {
      await this.assertUserCanScoreOrg(match.organizationId, context?.userId);
    }
    await this.frozenResults?.assertExchangeCreationAllowed(matchId, context?.userId);
    if (!dto.rulesetEntryId && !dto.directCard) {
      throw new BadRequestException('Either rulesetEntryId or directCard is required');
    }
    if (dto.directCard && !dto.reason?.trim()) {
      throw new BadRequestException('A reason is required for direct card penalties');
    }

    const { data: existing } = await this.supabase.service
      .from('match_penalties')
      .select('*')
      .eq('client_uuid', dto.clientUuid)
      .maybeSingle();
    if (existing) return existing;

    if (![match.redRegistrationId, match.blueRegistrationId].includes(dto.registrationId)) {
      throw new BadRequestException('Penalty registration must belong to the current match');
    }

    const sanction =
      dto.directCard !== undefined
        ? computeDirectPenaltySanction(dto.directCard)
        : await this.computeRulesetPenalty(match, dto);

    const opponentRegistrationId =
      dto.registrationId === match.redRegistrationId
        ? match.blueRegistrationId
        : match.redRegistrationId;

    const insertPayload: Record<string, unknown> = {
      client_uuid: dto.clientUuid,
      match_id: match.id,
      tournament_id: match.tournamentId,
      registration_id: dto.registrationId,
      ruleset_id: dto.directCard ? null : match.penaltyRulesetId,
      ruleset_entry_id: dto.rulesetEntryId ?? null,
      sequence: dto.sequence,
      source: dto.directCard ? 'direct' : 'ruleset',
      card: sanction.card,
      group_number: 'entry' in sanction ? null : null,
      ref_number: null,
      short_name: null,
      reason: dto.reason ?? null,
      score_delta: sanction.scoreDelta,
      causes_match_forfeit: sanction.causesMatchForfeit,
      by_user_id: context?.userId ?? null,
      staff_account_id: context?.staffAccountId ?? null,
      occurred_at: dto.occurredAt,
      voided: false,
    };

    if (!dto.directCard && dto.rulesetEntryId) {
      const entry = await this.getRulesetEntry(dto.rulesetEntryId);
      insertPayload.group_number = entry.groupNumber;
      insertPayload.ref_number = entry.refNumber;
      insertPayload.short_name = entry.shortName;
    }

    const { data, error } = await this.supabase.service
      .from('match_penalties')
      .insert(insertPayload)
      .select('*')
      .single();
    if (error) {
      if (error.message.includes('unique') || error.message.includes('duplicate')) {
        const { data: raceExisting } = await this.supabase.service
          .from('match_penalties')
          .select('*')
          .eq('client_uuid', dto.clientUuid)
          .maybeSingle();
        if (raceExisting) return raceExisting;
      }
      throw new BadRequestException(error.message);
    }

    await this.scoring?.recomputeMatchScore(matchId);

    if (sanction.causesMatchForfeit) {
      if (this.forfeits) {
        await this.forfeits.createForfeit(
          matchId,
          {
            forfeitingRegistrationId: dto.registrationId,
            reason: 'black_card_1',
            canContinue: true,
            note: dto.reason ?? 'Black card',
          },
          context,
        );
      } else {
        await this.supabase.service
          .from('matches')
          .update({
            status: 'completed',
            ended_at: new Date().toISOString(),
            winner_registration_id: opponentRegistrationId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', matchId);
      }
      await this.createSecondBlackCardReviewIfNeeded(match.tournamentId, dto.registrationId);
    }

    return data;
  }

  async voidPenalty(
    penaltyId: string,
    dto: VoidPenaltyDto,
    context?: { userId?: string; staffAccountId?: string; canOverrideLocked?: boolean },
  ) {
    const { data: penalty, error: fetchError } = await this.supabase.service
      .from('match_penalties')
      .select('*')
      .eq('id', penaltyId)
      .maybeSingle();
    if (fetchError) throw new BadRequestException(fetchError.message);
    if (!penalty) throw new NotFoundException(`Penalty ${penaltyId} not found`);
    const row = penalty as Row;
    const match = await this.getMatchContext(row['match_id'] as string);
    this.assertMatchNotLocked(match, context);
    if (!context?.staffAccountId) {
      await this.assertUserCanScoreOrg(match.organizationId, context?.userId);
    }
    if (row['voided']) throw new BadRequestException('Penalty is already voided');

    const { data, error } = await this.supabase.service
      .from('match_penalties')
      .update({ voided: true, voided_reason: dto.reason ?? null })
      .eq('id', penaltyId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    await this.scoring?.recomputeMatchScore(row['match_id'] as string);
    return data;
  }

  async listTournamentReviews(tournamentId: string) {
    const { data, error } = await this.supabase.service
      .from('tournament_penalty_reviews')
      .select('*')
      .eq('tournament_id', tournamentId)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async reviewTournamentPenalty(reviewId: string, dto: ReviewPenaltyDto, userId?: string) {
    const { data: existing, error: fetchError } = await this.supabase.service
      .from('tournament_penalty_reviews')
      .select('*')
      .eq('id', reviewId)
      .maybeSingle();
    if (fetchError) throw new BadRequestException(fetchError.message);
    if (!existing) throw new NotFoundException(`Penalty review ${reviewId} not found`);
    const review = existing as Row;
    await this.assertUserCanManageOrg(
      await this.getTournamentOrganizationId(review['tournament_id'] as string),
      userId,
    );

    if (dto.status === 'confirmed') {
      await this.supabase.service
        .from('registrations')
        .update({ status: 'disqualified' })
        .eq('id', review['registration_id'] as string);
    }

    const { data, error } = await this.supabase.service
      .from('tournament_penalty_reviews')
      .update({
        status: dto.status,
        reviewed_by_user_id: userId ?? null,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', reviewId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  private async computeRulesetPenalty(match: MatchContext, dto: CreatePenaltyDto) {
    if (!match.penaltyRulesetId) {
      throw new BadRequestException('No penalty ruleset is attached to this tournament or event');
    }
    const entry = await this.getRulesetEntry(dto.rulesetEntryId!);
    const previous = await this.getExistingPenaltiesForScope(match, dto.registrationId);
    return computePenaltySanction(entry, previous, dto.registrationId);
  }

  private async getExistingPenaltiesForScope(
    match: MatchContext,
    registrationId: string,
  ): Promise<ExistingPenaltyForSanction[]> {
    const ruleset = await this.getRuleset(match.penaltyRulesetId!);
    const accumulationScope = (ruleset as Row)['accumulation_scope'] as string;
    let q = this.supabase.service
      .from('match_penalties')
      .select('*')
      .eq('registration_id', registrationId)
      .eq('source', 'ruleset')
      .eq('voided', false);

    if (accumulationScope === 'match') {
      q = q.eq('match_id', match.id) as typeof q;
    } else {
      q = q.eq('tournament_id', match.tournamentId) as typeof q;
    }

    const { data, error } = await q.order('sequence', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((row) => {
      const penalty = row as Row;
      return {
        registrationId: penalty['registration_id'] as string,
        groupNumber: penalty['group_number'] as number | undefined,
        card: penalty['card'] as PenaltyCard,
        source: penalty['source'] as 'ruleset' | 'direct',
        voided: Boolean(penalty['voided']),
      };
    });
  }

  private async getRulesetEntry(entryId: string): Promise<PenaltyRulesetEntry> {
    const { data, error } = await this.supabase.service
      .from('penalty_ruleset_entries')
      .select('*')
      .eq('id', entryId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Penalty ruleset entry ${entryId} not found`);
    const row = data as Row;
    return {
      groupNumber: row['group_number'] as number,
      refNumber: row['ref_number'] as number,
      shortName: row['short_name'] as string,
      description: row['description'] as string,
      sanctions: row['sanctions'] as PenaltyCard[],
    };
  }

  private async getMatchContext(matchId: string): Promise<MatchContext> {
    const { data: matchData, error: matchError } = await this.supabase.service
      .from('matches')
      .select('id, red_registration_id, blue_registration_id, phase_id, locked_at')
      .eq('id', matchId)
      .maybeSingle();
    if (matchError) throw new BadRequestException(matchError.message);
    if (!matchData) throw new NotFoundException(`Match ${matchId} not found`);
    const match = matchData as Row;

    const { data: phaseData, error: phaseError } = await this.supabase.service
      .from('phases')
      .select('id, tournament_id')
      .eq('id', match['phase_id'] as string)
      .maybeSingle();
    if (phaseError) throw new BadRequestException(phaseError.message);
    if (!phaseData) throw new NotFoundException(`Phase ${String(match['phase_id'])} not found`);
    const phase = phaseData as Row;

    const { data: tournamentData, error: tournamentError } = await this.supabase.service
      .from('tournaments')
      .select('id, event_id, penalty_ruleset_id')
      .eq('id', phase['tournament_id'] as string)
      .maybeSingle();
    if (tournamentError) throw new BadRequestException(tournamentError.message);
    if (!tournamentData)
      throw new NotFoundException(`Tournament ${String(phase['tournament_id'])} not found`);
    const tournament = tournamentData as Row;

    const { data: eventData } = await this.supabase.service
      .from('events')
      .select('id, organization_id, penalty_ruleset_id')
      .eq('id', tournament['event_id'] as string)
      .maybeSingle();
    const event = (eventData ?? {}) as Row;

    return {
      id: match['id'] as string,
      lockedAt: (match['locked_at'] as string | null) ?? null,
      redRegistrationId: match['red_registration_id'] as string,
      blueRegistrationId: match['blue_registration_id'] as string,
      tournamentId: tournament['id'] as string,
      eventId: tournament['event_id'] as string,
      organizationId: event['organization_id'] as string,
      penaltyRulesetId:
        (tournament['penalty_ruleset_id'] as string | null) ??
        (event['penalty_ruleset_id'] as string | null) ??
        null,
    };
  }

  private assertMatchNotLocked(
    match: { lockedAt?: string | null },
    context?: { canOverrideLocked?: boolean },
  ) {
    if (match.lockedAt && !context?.canOverrideLocked) {
      throw new BadRequestException('Match is locked');
    }
  }

  private async getEventOrganizationId(eventId: string): Promise<string> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('organization_id')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Event ${eventId} not found`);
    return (data as Row)['organization_id'] as string;
  }

  private async getTournamentOrganizationId(tournamentId: string): Promise<string> {
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .select('event_id')
      .eq('id', tournamentId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Tournament ${tournamentId} not found`);
    return this.getEventOrganizationId((data as Row)['event_id'] as string);
  }

  private async assertUserCanManageOrg(orgId: string, userId?: string): Promise<void> {
    if (!userId) throw new UnauthorizedException('Authentication required');
    if (this.orgs) await this.orgs.assertOrgRole(orgId, userId, 'admin');
  }

  private async assertUserCanScoreOrg(orgId: string, userId?: string): Promise<void> {
    if (!userId) throw new UnauthorizedException('Authentication required');
    if (this.orgs) await this.orgs.assertOrgRole(orgId, userId, 'scorekeeper');
  }

  private async createSecondBlackCardReviewIfNeeded(tournamentId: string, registrationId: string) {
    const { data, error } = await this.supabase.service
      .from('match_penalties')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('registration_id', registrationId)
      .eq('card', 'black')
      .eq('voided', false)
      .order('occurred_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    const count = (data ?? []).length;
    if (count < 2) return;

    await this.supabase.service.from('tournament_penalty_reviews').upsert({
      tournament_id: tournamentId,
      registration_id: registrationId,
      review_type: 'second_black_card',
      status: 'pending',
      black_card_count: count,
      payload_json: { penaltyIds: (data ?? []).map((row) => (row as Row)['id']) },
      updated_at: new Date().toISOString(),
    });
  }

  private async replaceEntries(
    rulesetId: string,
    entries: CreatePenaltyRulesetDto['entries'],
  ): Promise<void> {
    const rows = entries.map((entry, index) => ({
      ruleset_id: rulesetId,
      group_number: entry.groupNumber,
      ref_number: entry.refNumber,
      short_name: entry.shortName,
      description: entry.description,
      sanctions: entry.sanctions,
      sort_order: index + 1,
    }));
    const { error } = await this.supabase.service.from('penalty_ruleset_entries').insert(rows);
    if (error) throw new BadRequestException(error.message);
  }

  private async ensureBuiltInRuleset(): Promise<void> {
    const { data: existing } = await this.supabase.service
      .from('penalty_rulesets')
      .select('id')
      .eq('code', BUILTIN_CODE)
      .eq('version', BUILTIN_VERSION)
      .is('owner_organization_id', null)
      .maybeSingle();
    if (existing) return;

    const csv = this.readBuiltInCsv();
    if (!csv) {
      this.logger.warn('FFAMHE penalty CSV not found; built-in penalty ruleset was not seeded');
      return;
    }
    const parsed = parsePenaltyRulesetCsv(csv, {
      code: BUILTIN_CODE,
      name: BUILTIN_NAME,
      version: BUILTIN_VERSION,
      accumulationScope: 'match',
      builtIn: true,
    });
    const hash = createHash('sha256').update(csv).digest('hex');
    const { data: ruleset, error } = await this.supabase.service
      .from('penalty_rulesets')
      .insert({
        code: parsed.code,
        version: parsed.version,
        name: parsed.name,
        built_in: true,
        public_visibility: true,
        accumulation_scope: parsed.accumulationScope,
        csv_source_name: 'ffamhe_tf_2026.csv',
        csv_source_sha256: hash,
      })
      .select('*')
      .single();
    if (error || !ruleset) {
      if (error) this.logger.warn(`Could not seed built-in penalty ruleset: ${error.message}`);
      return;
    }
    await this.replaceEntries(
      (ruleset as Row)['id'] as string,
      parsed.entries.map((entry) => ({
        groupNumber: entry.groupNumber,
        refNumber: entry.refNumber,
        shortName: entry.shortName,
        description: entry.description,
        sanctions: [...entry.sanctions],
      })),
    );
  }

  private readBuiltInCsv(): string | null {
    const candidates = [
      join(process.cwd(), '../../packages/rulesets/src/penalties/data/ffamhe_tf_2026.csv'),
      join(process.cwd(), 'packages/rulesets/src/penalties/data/ffamhe_tf_2026.csv'),
      join(__dirname, '../../../../../packages/rulesets/src/penalties/data/ffamhe_tf_2026.csv'),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
    }
    return null;
  }
}

interface MatchContext {
  id: string;
  lockedAt: string | null;
  redRegistrationId: string;
  blueRegistrationId: string;
  tournamentId: string;
  eventId: string;
  organizationId: string;
  penaltyRulesetId: string | null;
}
