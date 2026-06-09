import {
  BadRequestException,
  ForbiddenException,
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
  UpdatePenaltyRulesetDto,
  VoidPenaltyDto,
} from './dto/penalties.dto';

type Row = Record<string, unknown>;

// Built-in penalty ruleset identifiers. The row itself is seeded by
// migration 0054 (no longer at runtime), but these constants are still
// used by getEffectiveRulesetForMatch() to look up the platform default
// when a tournament/event has no explicit penalty_ruleset_id.
const BUILTIN_CODE = 'ffamhe_tf_2026';
const BUILTIN_VERSION = '2026';

export type BlackCardForfeitScope = 'match' | 'tournament' | 'none';

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
    const { data, error } = await this.supabase.service
      .from('penalty_rulesets')
      .select('*')
      .order('built_in', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async getRuleset(rulesetId: string) {
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
    const insertRow: Record<string, unknown> = {
      owner_organization_id: dto.ownerOrganizationId,
      code: dto.code,
      version: dto.version,
      name: dto.name.trim(),
      description: dto.description ?? null,
      accumulation_scope: dto.accumulationScope,
      public_visibility: dto.publicVisibility,
      built_in: false,
      created_by_user_id: userId ?? null,
    };
    // Card costs + forfeit scopes: only forward when the caller provided
    // them so the column defaults (yellow=0, red=-1, black=0; first=match,
    // second=tournament) apply for callers that don't care.
    if (dto.yellowCardPoints !== undefined) insertRow['yellow_card_points'] = dto.yellowCardPoints;
    if (dto.redCardPoints !== undefined) insertRow['red_card_points'] = dto.redCardPoints;
    if (dto.blackCardPoints !== undefined) insertRow['black_card_points'] = dto.blackCardPoints;
    if (dto.firstBlackCardForfeit !== undefined)
      insertRow['first_black_card_forfeit'] = dto.firstBlackCardForfeit;
    if (dto.secondBlackCardForfeit !== undefined)
      insertRow['second_black_card_forfeit'] = dto.secondBlackCardForfeit;

    const { data, error } = await this.supabase.service
      .from('penalty_rulesets')
      .insert(insertRow)
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

  /**
   * Patch a penalty ruleset's metadata and optionally its full entries list.
   *
   * Auth model:
   *   - built_in rows are editable only by super-admin (mirrors the TF v1
   *     scoring-ruleset pattern). The RLS update policy blocks built_in
   *     edits at the row level, but we write via service-role so the gate
   *     is the in-service `isSuperAdmin` check below.
   *   - Custom rows: org-admin of the owning org (or super-admin).
   *
   * Entries are replaced wholesale when `dto.entries` is provided: delete
   * existing rows, then bulk-insert the new set. Skip when omitted.
   */
  async updateRuleset(id: string, dto: UpdatePenaltyRulesetDto, userId?: string) {
    const { data: existing, error: readErr } = await this.supabase.service
      .from('penalty_rulesets')
      .select('id, owner_organization_id, built_in')
      .eq('id', id)
      .maybeSingle();
    if (readErr) throw new BadRequestException(readErr.message);
    if (!existing) throw new NotFoundException(`Penalty ruleset ${id} not found`);

    const row = existing as Row;
    if (row['built_in']) {
      if (!userId) throw new UnauthorizedException('Authentication required');
      const superAdmin = await this.isSuperAdmin(userId);
      if (!superAdmin) {
        throw new ForbiddenException('Only super-admin can edit the built-in penalty ruleset');
      }
    } else {
      await this.assertUserCanManageOrg(row['owner_organization_id'] as string, userId);
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) updates['name'] = dto.name.trim();
    if (dto.description !== undefined) updates['description'] = dto.description ?? null;
    if (dto.accumulationScope !== undefined) updates['accumulation_scope'] = dto.accumulationScope;
    if (dto.publicVisibility !== undefined) updates['public_visibility'] = dto.publicVisibility;
    if (dto.yellowCardPoints !== undefined) updates['yellow_card_points'] = dto.yellowCardPoints;
    if (dto.redCardPoints !== undefined) updates['red_card_points'] = dto.redCardPoints;
    if (dto.blackCardPoints !== undefined) updates['black_card_points'] = dto.blackCardPoints;
    if (dto.firstBlackCardForfeit !== undefined)
      updates['first_black_card_forfeit'] = dto.firstBlackCardForfeit;
    if (dto.secondBlackCardForfeit !== undefined)
      updates['second_black_card_forfeit'] = dto.secondBlackCardForfeit;

    const { error: updateErr } = await this.supabase.service
      .from('penalty_rulesets')
      .update(updates)
      .eq('id', id);
    if (updateErr) throw new BadRequestException(updateErr.message);

    if (dto.entries !== undefined) {
      const { error: delErr } = await this.supabase.service
        .from('penalty_ruleset_entries')
        .delete()
        .eq('ruleset_id', id);
      if (delErr) throw new BadRequestException(delErr.message);
      if (dto.entries.length > 0) {
        await this.replaceEntries(id, dto.entries);
      }
    }

    return this.getRuleset(id);
  }

  /**
   * Delete a custom (non-built-in) penalty ruleset. The built-in row is
   * never deletable — it's the implicit fallback for tournaments with
   * `penalty_ruleset_id = NULL`. Custom rows are removable by their
   * owning org's admins (or super-admin). `match_penalties.ruleset_id`
   * is ON DELETE SET NULL, so historic penalty records survive.
   */
  async deleteRuleset(id: string, userId?: string): Promise<void> {
    const { data: existing, error: readErr } = await this.supabase.service
      .from('penalty_rulesets')
      .select('id, owner_organization_id, built_in')
      .eq('id', id)
      .maybeSingle();
    if (readErr) throw new BadRequestException(readErr.message);
    if (!existing) throw new NotFoundException(`Penalty ruleset ${id} not found`);

    const row = existing as Row;
    if (row['built_in']) {
      throw new ForbiddenException('The built-in penalty ruleset cannot be deleted');
    }
    await this.assertUserCanManageOrg(row['owner_organization_id'] as string, userId);

    const { error: delErr } = await this.supabase.service
      .from('penalty_rulesets')
      .delete()
      .eq('id', id);
    if (delErr) throw new BadRequestException(delErr.message);
  }

  // ── R3: "Submit for sharing" promotion workflow ──────────────────────────

  /**
   * Org-admin action — flip the ruleset's request status to 'pending' so
   * a super-admin can review it and approve for platform-wide sharing.
   * Built-in and already-public rows can't be submitted (they're already
   * visible to everyone). Validates ownership via assertUserCanManageOrg
   * on the row's owner.
   */
  async submitRulesetForSharing(id: string, userId?: string) {
    const existing = await this.loadRulesetForSharing(id);
    if (existing.built_in) {
      throw new BadRequestException('Built-in rulesets do not need to be submitted for sharing');
    }
    if (existing.public_visibility) {
      throw new BadRequestException('This ruleset is already shared platform-wide');
    }
    await this.assertUserCanManageOrg(existing.owner_organization_id ?? '', userId);

    const { data, error } = await this.supabase.service
      .from('penalty_rulesets')
      .update({
        public_visibility_request_status: 'pending',
        public_visibility_request_reason: null,
        public_visibility_requested_at: new Date().toISOString(),
        public_visibility_reviewed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Submit failed');
    return data;
  }

  /**
   * Super-admin action — approve a pending sharing request. Flips
   * public_visibility=true so the row appears in every org's
   * listRulesetsForOrg result + every tournament's penalty-ruleset
   * dropdown.
   */
  async approveRulesetSharing(id: string, userId?: string) {
    if (!userId) throw new UnauthorizedException('Authentication required');
    if (!(await this.isSuperAdmin(userId))) {
      throw new ForbiddenException('Only super-admin can approve sharing');
    }
    const existing = await this.loadRulesetForSharing(id);
    if (existing.public_visibility_request_status !== 'pending') {
      throw new BadRequestException('No pending sharing request to approve');
    }

    const { data, error } = await this.supabase.service
      .from('penalty_rulesets')
      .update({
        public_visibility: true,
        public_visibility_request_status: 'approved',
        public_visibility_request_reason: null,
        public_visibility_reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Approve failed');
    return data;
  }

  /**
   * Super-admin action — reject the sharing request with a reason. The
   * row remains org-private; the org can fix the issue and resubmit.
   */
  async rejectRulesetSharing(id: string, reason: string, userId?: string) {
    if (!userId) throw new UnauthorizedException('Authentication required');
    if (!(await this.isSuperAdmin(userId))) {
      throw new ForbiddenException('Only super-admin can reject sharing');
    }
    const trimmed = reason.trim();
    if (!trimmed) throw new BadRequestException('A rejection reason is required');
    const existing = await this.loadRulesetForSharing(id);
    if (existing.public_visibility_request_status !== 'pending') {
      throw new BadRequestException('No pending sharing request to reject');
    }

    const { data, error } = await this.supabase.service
      .from('penalty_rulesets')
      .update({
        public_visibility_request_status: 'rejected',
        public_visibility_request_reason: trimmed,
        public_visibility_reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Reject failed');
    return data;
  }

  /**
   * Tight read for sharing-flow validation. Returns just the columns each
   * approve/reject/submit path needs to inspect.
   */
  private async loadRulesetForSharing(id: string): Promise<{
    id: string;
    built_in: boolean;
    owner_organization_id: string | null;
    public_visibility: boolean;
    public_visibility_request_status: 'pending' | 'approved' | 'rejected' | null;
  }> {
    const { data, error } = await this.supabase.service
      .from('penalty_rulesets')
      .select(
        'id, built_in, owner_organization_id, public_visibility, public_visibility_request_status',
      )
      .eq('id', id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Penalty ruleset ${id} not found`);
    return data as {
      id: string;
      built_in: boolean;
      owner_organization_id: string | null;
      public_visibility: boolean;
      public_visibility_request_status: 'pending' | 'approved' | 'rejected' | null;
    };
  }

  /**
   * List penalty rulesets relevant to an organization: the built-in (always
   * visible) + any rulesets owned by `orgId`. Used by the organizer-facing
   * /org/[slug]/penalty-rulesets page and the tournament settings dropdown
   * to avoid showing other orgs' public rulesets.
   */
  async listRulesetsForOrg(orgId: string, userId?: string) {
    await this.assertUserCanManageOrg(orgId, userId);
    const { data, error } = await this.supabase.service
      .from('penalty_rulesets')
      .select('*')
      .or(`built_in.eq.true,owner_organization_id.eq.${orgId}`)
      .order('built_in', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
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

    // Load the active penalty ruleset row once so we can read its card-cost
    // columns and forfeit-scope settings. computePenaltySanction returns a
    // hardcoded `scoreDelta` based on card colour; the row's per-card
    // columns override that so operators can tune values per ruleset.
    const activePenaltyRuleset = match.penaltyRulesetId
      ? await this.loadPenaltyRulesetRow(match.penaltyRulesetId)
      : null;
    const scoreDelta = activePenaltyRuleset
      ? this.cardScoreDelta(activePenaltyRuleset, sanction.card)
      : sanction.scoreDelta;

    // For non-black cards `causes_match_forfeit` stays as the sanction said
    // (false). For black cards we'll override based on the resolved scope
    // below — but at this point we just record the card.
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
      score_delta: scoreDelta,
      causes_match_forfeit: sanction.causesMatchForfeit,
      by_user_id: context?.userId ?? null,
      staff_account_id: context?.staffAccountId ?? null,
      occurred_at: dto.occurredAt,
      clock_time_ms: dto.clockTimeMs ?? null,
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
      // Determine the ordinal: count this registration's non-voided black
      // cards in the tournament (including the row we just inserted).
      const blackCount = await this.countBlackCardsForRegistration(
        match.tournamentId,
        dto.registrationId,
      );
      const scoringConfig = await this.loadTournamentRulesetConfig(match.tournamentId);
      const scope: BlackCardForfeitScope = activePenaltyRuleset
        ? this.resolveBlackCardForfeitScope(activePenaltyRuleset, scoringConfig, blackCount)
        : blackCount >= 2
          ? 'tournament'
          : 'match';

      if (scope !== 'none') {
        if (this.forfeits) {
          await this.forfeits.createForfeit(
            matchId,
            {
              forfeitingRegistrationId: dto.registrationId,
              reason: blackCount >= 2 ? 'black_card_2' : 'black_card_1',
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
      }

      // Tournament-wide scope short-circuits the manual review path: mark
      // the registration disqualified immediately. The standard 2nd-black
      // review still gets created for audit/visibility.
      if (scope === 'tournament') {
        await this.supabase.service
          .from('registrations')
          .update({ status: 'disqualified' })
          .eq('id', dto.registrationId);
      }
      await this.createSecondBlackCardReviewIfNeeded(match.tournamentId, dto.registrationId);
    }

    return data;
  }

  /**
   * Per-card point cost from the active penalty ruleset row. The row's
   * yellow_/red_/black_card_points columns override the hardcoded
   * penaltyScoreDelta() values that computePenaltySanction returns.
   */
  private cardScoreDelta(rulesetRow: Row, card: PenaltyCard): number {
    const key =
      card === 'yellow'
        ? 'yellow_card_points'
        : card === 'red'
          ? 'red_card_points'
          : 'black_card_points';
    const value = rulesetRow[key];
    return typeof value === 'number' ? value : 0;
  }

  private async loadPenaltyRulesetRow(rulesetId: string): Promise<Row | null> {
    const { data } = await this.supabase.service
      .from('penalty_rulesets')
      .select(
        'id, yellow_card_points, red_card_points, black_card_points, first_black_card_forfeit, second_black_card_forfeit',
      )
      .eq('id', rulesetId)
      .maybeSingle();
    return (data as Row | null) ?? null;
  }

  private async loadTournamentRulesetConfig(
    tournamentId: string,
  ): Promise<Record<string, unknown> | null> {
    const { data } = await this.supabase.service
      .from('tournaments')
      .select('ruleset_config')
      .eq('id', tournamentId)
      .maybeSingle();
    return (data as { ruleset_config?: Record<string, unknown> } | null)?.ruleset_config ?? null;
  }

  private async countBlackCardsForRegistration(
    tournamentId: string,
    registrationId: string,
  ): Promise<number> {
    const { count } = await this.supabase.service
      .from('match_penalties')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', tournamentId)
      .eq('registration_id', registrationId)
      .eq('card', 'black')
      .eq('voided', false);
    return count ?? 0;
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
      refNumber: row['ref_number'] as string,
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
    if (await this.isSuperAdmin(userId)) return;
    if (this.orgs) await this.orgs.assertOrgRole(orgId, userId, 'admin');
  }

  /**
   * Resolve whether `userId` carries the platform `super_admin` role. Matches
   * the lookup pattern used by leagues.service.ts:isSuperAdmin().
   */
  private async isSuperAdmin(userId: string): Promise<boolean> {
    if (!userId || userId === 'anonymous') return false;
    const { data } = await this.supabase.service
      .from('platform_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'super_admin')
      .maybeSingle();
    return Boolean(data);
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
    // Validate refNumber shape at the API boundary. The DB column is plain
    // TEXT (migration 0071) so without this guard a caller could push
    // anything in. Keep the constraint loose enough for real rulebook
    // codes (R7a, B-12) but tight enough to prevent free-form text.
    const REF_RE = /^[\w-]{1,20}$/;
    for (const entry of entries) {
      const ref = String(entry.refNumber ?? '').trim();
      if (!REF_RE.test(ref)) {
        throw new BadRequestException(
          `Invalid penalty REF "${entry.refNumber}" — must be 1–20 chars, letters/digits/underscore/hyphen only.`,
        );
      }
    }
    const rows = entries.map((entry, index) => ({
      ruleset_id: rulesetId,
      group_number: entry.groupNumber,
      ref_number: String(entry.refNumber).trim(),
      short_name: entry.shortName,
      description: entry.description,
      sanctions: entry.sanctions,
      sort_order: index + 1,
    }));
    const { error } = await this.supabase.service.from('penalty_ruleset_entries').insert(rows);
    if (error) throw new BadRequestException(error.message);
  }

  /**
   * Resolve where a black-card forfeit should land:
   * - 'match'      → end this match (current default behaviour).
   * - 'tournament' → end the match AND mark the registration as disqualified
   *                  for the rest of the tournament.
   * - 'none'       → record the card but don't end the match.
   *
   * Source-of-truth precedence:
   *   1. Tournament's scoring ruleset (TF v1 forfeitPolicy.black_card_{1,2}.
   *      tournamentState) — if it's a concrete value ('match_only',
   *      'withdrawn', 'disqualified'), it wins.
   *   2. Else fall back to penalty ruleset's first_/second_black_card_forfeit
   *      columns (defaults: 'match', 'tournament').
   *
   * `ordinal` is 1 for the registration's first non-voided black card in
   * the tournament, 2 for the second, etc.
   */
  private resolveBlackCardForfeitScope(
    penaltyRuleset: Row,
    scoringRulesetConfig: Record<string, unknown> | null,
    ordinal: number,
  ): BlackCardForfeitScope {
    const policyKey = ordinal >= 2 ? 'black_card_2' : 'black_card_1';
    const policy = (
      (scoringRulesetConfig?.['forfeitPolicy'] as Record<string, unknown> | undefined)?.[
        'reasons'
      ] as Record<string, { tournamentState?: string } | undefined> | undefined
    )?.[policyKey];
    const overrideState = policy?.tournamentState;
    if (overrideState === 'match_only') return 'match';
    if (overrideState === 'withdrawn' || overrideState === 'disqualified') return 'tournament';
    // 'ask' or undefined → penalty ruleset default wins.
    const column = ordinal >= 2 ? 'second_black_card_forfeit' : 'first_black_card_forfeit';
    const value = penaltyRuleset[column] as BlackCardForfeitScope | undefined;
    return value ?? (ordinal >= 2 ? 'tournament' : 'match');
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
