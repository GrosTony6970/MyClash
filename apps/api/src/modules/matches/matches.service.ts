import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FollowNotificationSchedulerService } from '../../workers/follow-notification-scheduler.worker';
import { NotificationSchedulerService } from '../../workers/notification-scheduler.worker';
import { SupabaseService } from '../supabase/supabase.service';
import { buildRoundCode } from './round-code.helper';
import { ScoringService } from './scoring.service';
import { FrozenResultsGuard } from './frozen-results.guard';
import type { BracketAdvanceService } from '../phases/bracket-advance.service';
import type {
  CreateExchangeDto,
  CreateMatchDto,
  EditExchangeDto,
  ResetMatchDto,
  UpdateMatchDto,
  UpdateMatchStatusDto,
  VoidExchangeDto,
} from './dto/matches.dto';

type MatchActor = { userId?: string; staffAccountId?: string; canOverrideLocked?: boolean };

@Injectable()
export class MatchesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly scoring: ScoringService,
    private readonly notifications: NotificationSchedulerService,
    private readonly followNotifications: FollowNotificationSchedulerService,
    @Optional() private readonly frozenResults?: FrozenResultsGuard,
    @Optional() private readonly bracketAdvance?: BracketAdvanceService,
  ) {}

  // ── Matches ──────────────────────────────────────────────────────────────────

  async listByPhase(phaseId: string) {
    const { data, error } = await this.supabase.service
      .from('matches')
      .select('*')
      .eq('phase_id', phaseId)
      .order('match_number_label', { ascending: true });

    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async getMatch(matchId: string) {
    const { data, error } = await this.supabase.service
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Match ${matchId} not found`);
    return data;
  }

  /**
   * Compact header summary for the scoreboard page.
   * Returns fighter names, club abbreviations, pool name, match label, and weapon.
   * Public endpoint — no auth required (same as getMatch).
   */
  async getMatchSummary(matchId: string) {
    const { data, error } = await this.supabase.service
      .from('vw_tournament_query_matches')
      .select(
        'match_id, match_number_label, status, pool_id, pool_name, bracket_round, red_name, blue_name, red_club, blue_club, tournament_id, phase_id',
      )
      .eq('match_id', matchId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Match ${matchId} not found`);

    const row = data as {
      match_id: string;
      match_number_label: string | null;
      status: string;
      pool_id: string | null;
      pool_name: string | null;
      bracket_round: number | null;
      red_name: string | null;
      blue_name: string | null;
      red_club: string | null;
      blue_club: string | null;
      tournament_id: string;
      phase_id: string | null;
    };

    // Fetch weapon from tournament (not in view).
    const { data: tournament } = await this.supabase.service
      .from('tournaments')
      .select('weapon')
      .eq('id', row.tournament_id)
      .maybeSingle();
    const weapon = (tournament as { weapon?: string | null } | null)?.weapon ?? null;

    // For bracket matches, fetch the phase's bracketSize so the
    // formatter resolves bracket_round → R16/QF/SF/F instead of
    // falling back to B{round}. Stored at bracket-generation time in
    // phases.config_json.
    let bracketSize: number | null = null;
    if (row.bracket_round !== null && row.phase_id) {
      const { data: phaseRow } = await this.supabase.service
        .from('phases')
        .select('config_json')
        .eq('id', row.phase_id)
        .maybeSingle();
      const cfg = (phaseRow as { config_json?: Record<string, unknown> } | null)?.config_json;
      const size = (cfg?.['bracketSize'] ?? cfg?.['mainBracketSize']) as number | undefined;
      if (typeof size === 'number') bracketSize = size;
    }

    // Pool sort_order isn't projected by vw_tournament_query_matches, so
    // we fetch it here when the match belongs to a pool — needed to feed
    // formatRoundCode's poolNumber (1-indexed).
    let poolNumber: number | null = null;
    if (row.pool_id) {
      const { data: pool } = await this.supabase.service
        .from('pools')
        .select('sort_order')
        .eq('id', row.pool_id)
        .maybeSingle();
      const sortOrder = (pool as { sort_order?: number | null } | null)?.sort_order;
      if (typeof sortOrder === 'number') poolNumber = sortOrder + 1;
    }

    const roundCode = buildRoundCode({
      weapon,
      poolNumber,
      bracketRound: row.bracket_round,
      bracketSize,
      matchNumberLabel: row.match_number_label,
      roundNumber: null,
    });

    return {
      matchLabel: row.match_number_label ?? '',
      roundCode,
      status: row.status,
      poolName: row.pool_name ?? '',
      redName: row.red_name ?? '',
      redClub: row.red_club ?? null,
      blueName: row.blue_name ?? '',
      blueClub: row.blue_club ?? null,
      weapon: weapon ?? '',
    };
  }

  async createMatch(dto: CreateMatchDto) {
    const { data, error } = await this.supabase.service
      .from('matches')
      .insert({
        phase_id: dto.phaseId,
        pool_id: dto.poolId ?? null,
        lice_id: dto.liceId ?? null,
        red_registration_id: dto.redRegistrationId,
        blue_registration_id: dto.blueRegistrationId,
        scheduled_at: dto.scheduledAt ?? null,
        ruleset_code: dto.rulesetCode ?? 'TF_v1',
        ruleset_version: dto.rulesetVersion ?? '1.0.0',
        match_number_label: dto.matchNumberLabel ?? null,
        status: 'scheduled',
        red_score: 0,
        blue_score: 0,
      })
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateStatus(matchId: string, dto: UpdateMatchStatusDto) {
    const updates: Record<string, unknown> = {
      status: dto.status,
      updated_at: new Date().toISOString(),
    };

    if (dto.status === 'running') updates['started_at'] = new Date().toISOString();
    if (dto.status === 'completed') {
      updates['ended_at'] = new Date().toISOString();
      if (dto.winnerRegistrationId) {
        updates['winner_registration_id'] = dto.winnerRegistrationId;
      }
    }

    const { data, error } = await this.supabase.service
      .from('matches')
      .update(updates)
      .eq('id', matchId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);

    if (dto.status === 'completed' && this.bracketAdvance) {
      void this.bracketAdvance.onMatchCompleted(matchId);
    }

    return data;
  }

  async voidMatch(matchId: string) {
    return this.updateStatus(matchId, { status: 'voided' });
  }

  async scheduleMatch(matchId: string, liceId: string | null, scheduledAt: string | null) {
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    updates['lice_id'] = liceId || null;
    updates['scheduled_at'] = scheduledAt || null;

    const { data, error } = await this.supabase.service
      .from('matches')
      .update(updates)
      .eq('id', matchId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    await this.notifications.scheduleMatchStarting(matchId);
    await this.followNotifications.scheduleMatchStarting(matchId);
    return data;
  }

  /**
   * Set (or clear) the referee for a single (match, role) pair.
   *
   * Writes go to `referee_assignments` with `scope_type='match'`. This
   * is the per-role-column write path used by the pool tab's matches
   * table — distinct from the legacy single `matches.referee_id`
   * field that `update()` still maintains for back-compat. The legacy
   * field stays on the schema until a follow-up backfill migration
   * lands.
   *
   * Behaviour:
   *   refereeId = string  → delete any existing row for (match, role),
   *                         then insert the new assignment.
   *   refereeId = null    → delete any existing row, do not insert.
   */
  async setRefereeRoleAssignment(
    matchId: string,
    role: string,
    refereeId: string | null,
  ): Promise<{ matchId: string; role: string; refereeId: string | null }> {
    // 1. Load match to derive event_id (via phases.event_id) and to
    //    carry lice_id onto the assignment row so the assignment-board
    //    scheduling joins still resolve.
    const { data: match, error: matchErr } = await this.supabase.service
      .from('matches')
      .select('phase_id, lice_id')
      .eq('id', matchId)
      .maybeSingle();
    if (matchErr) throw new BadRequestException(matchErr.message);
    if (!match) throw new NotFoundException(`Match ${matchId} not found`);
    const phaseId = (match as { phase_id: string }).phase_id;
    const liceId = (match as { lice_id: string | null }).lice_id ?? null;

    const { data: phase, error: phaseErr } = await this.supabase.service
      .from('phases')
      .select('event_id')
      .eq('id', phaseId)
      .maybeSingle();
    if (phaseErr) throw new BadRequestException(phaseErr.message);
    if (!phase) throw new NotFoundException(`Phase ${phaseId} not found`);
    const eventId = (phase as { event_id: string }).event_id;

    // 2. Idempotent clear — delete any existing assignment for the
    //    (match, role) tuple. Mirrors the manual-assignment branch in
    //    AssignmentBoardService.persistAssignments.
    const { error: delErr } = await this.supabase.service
      .from('referee_assignments')
      .delete()
      .eq('scope_type', 'match')
      .eq('match_id', matchId)
      .eq('role', role);
    if (delErr) throw new BadRequestException(delErr.message);

    if (refereeId === null) {
      return { matchId, role, refereeId: null };
    }

    const { error: insErr } = await this.supabase.service.from('referee_assignments').insert({
      event_id: eventId,
      person_id: refereeId,
      scope_type: 'match',
      pool_id: null,
      match_id: matchId,
      lice_id: liceId,
      role,
      auto_assigned: false,
      status: 'assigned',
      conflicts_jsonb: [],
    });
    if (insErr) throw new BadRequestException(insErr.message);

    return { matchId, role, refereeId };
  }

  async update(matchId: string, dto: UpdateMatchDto) {
    const updates: Record<string, unknown> = {};
    if (dto.liceId !== undefined) updates['lice_id'] = dto.liceId;
    if (dto.refereeId !== undefined) updates['referee_id'] = dto.refereeId;
    if (Object.keys(updates).length === 0) {
      throw new BadRequestException('No fields to update');
    }
    updates['updated_at'] = new Date().toISOString();

    const { data, error } = await this.supabase.service
      .from('matches')
      .update(updates)
      .eq('id', matchId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Match ${matchId} not found`);
    return data;
  }

  // ── Exchanges ─────────────────────────────────────────────────────────────────

  async listExchanges(matchId: string) {
    const { data, error } = await this.supabase.service
      .from('exchanges')
      .select('*')
      .eq('match_id', matchId)
      .order('sequence', { ascending: true });

    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  /**
   * Insert an exchange — idempotent on client_uuid.
   * Recomputes match score after insert.
   *
   * AGENTS.md hard rule #1: score is derived from exchanges, never stored
   * as the source of truth.
   */
  async createExchange(matchId: string, dto: CreateExchangeDto, context?: MatchActor) {
    await this.frozenResults?.assertExchangeCreationAllowed(matchId, context?.userId);
    if (context) await this.assertMatchUnlocked(matchId, context);

    // Idempotency check: if client_uuid already exists, return existing row
    const { data: existing } = await this.supabase.service
      .from('exchanges')
      .select('*')
      .eq('client_uuid', dto.clientUuid)
      .maybeSingle();

    if (existing) {
      // Idempotent — return the existing exchange without error
      return existing;
    }

    // Compute score deltas for materialized columns
    const { redDelta, blueDelta } = this.computeDeltas(dto);

    const { data, error } = await this.supabase.service
      .from('exchanges')
      .insert({
        client_uuid: dto.clientUuid,
        match_id: matchId,
        sequence: dto.sequence,
        type: dto.type,
        occurred_at: dto.occurredAt,
        recorded_at: new Date().toISOString(),
        duration_since_prev_ms: dto.durationSincePrevMs ?? null,
        first_striker_color: dto.firstStrikerColor ?? null,
        first_strike_value: dto.firstStrikeValue ?? null,
        afterblow_value: dto.afterblowValue ?? null,
        no_exchange_reason: dto.noExchangeReason ?? null,
        red_score_delta: redDelta,
        blue_score_delta: blueDelta,
        staff_account_id: context?.staffAccountId ?? null,
        voided: false,
      })
      .select('*')
      .single();

    if (error) {
      // Handle race condition: another request inserted the same client_uuid
      if (error.message.includes('unique') || error.message.includes('duplicate')) {
        const { data: raceExisting } = await this.supabase.service
          .from('exchanges')
          .select('*')
          .eq('client_uuid', dto.clientUuid)
          .maybeSingle();
        if (raceExisting) return raceExisting;
      }
      throw new BadRequestException(error.message);
    }

    // Recompute authoritative match score from all non-voided exchanges
    await this.scoring.recomputeMatchScore(matchId);

    return data;
  }

  /**
   * Void an exchange — sets voided=true, never deletes.
   * Recomputes match score after void.
   *
   * AGENTS.md: "Voiding an exchange must never destroy the row."
   */
  async voidExchange(
    exchangeId: string,
    dto: VoidExchangeDto,
    context?: { userId?: string; staffAccountId?: string; bypassFrozenReview?: boolean },
  ) {
    const { data: exchange, error: fetchError } = await this.supabase.service
      .from('exchanges')
      .select('id, match_id, voided')
      .eq('id', exchangeId)
      .maybeSingle();

    if (fetchError || !exchange) throw new NotFoundException(`Exchange ${exchangeId} not found`);

    const ex = exchange as { id: string; match_id: string; voided: boolean };
    if (ex.voided) {
      throw new BadRequestException('Exchange is already voided');
    }
    if (context && !context.bypassFrozenReview)
      await this.assertMatchUnlocked(ex.match_id, context);

    if (!context?.bypassFrozenReview) {
      const pending = await this.frozenResults?.guardExchangeMutation({
        exchange: ex,
        requestType: 'void_exchange',
        reason: dto.reason ?? null,
        userId: context?.userId,
      });
      if (pending) return pending;
    }

    const { data, error } = await this.supabase.service
      .from('exchanges')
      .update({
        voided: true,
        voided_reason: dto.reason ?? null,
      })
      .eq('id', exchangeId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);

    // Recompute authoritative match score
    await this.scoring.recomputeMatchScore(ex.match_id);

    return data;
  }

  /**
   * Revert a voided exchange — sets voided=false, clears voided_reason.
   * Recomputes match score after restore.
   * AC: "Reverting a void restores the exchange."
   */
  async revertVoidExchange(
    exchangeId: string,
    context?: { userId?: string; staffAccountId?: string; bypassFrozenReview?: boolean },
  ) {
    const { data: exchange, error: fetchError } = await this.supabase.service
      .from('exchanges')
      .select('id, match_id, voided')
      .eq('id', exchangeId)
      .maybeSingle();

    if (fetchError || !exchange) throw new NotFoundException(`Exchange ${exchangeId} not found`);

    const ex = exchange as { id: string; match_id: string; voided: boolean };
    if (!ex.voided) {
      throw new BadRequestException('Exchange is not voided');
    }
    if (context && !context.bypassFrozenReview)
      await this.assertMatchUnlocked(ex.match_id, context);

    if (!context?.bypassFrozenReview) {
      const pending = await this.frozenResults?.guardExchangeMutation({
        exchange: ex,
        requestType: 'revert_void_exchange',
        reason: null,
        userId: context?.userId,
      });
      if (pending) return pending;
    }

    const { data, error } = await this.supabase.service
      .from('exchanges')
      .update({ voided: false, voided_reason: null })
      .eq('id', exchangeId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);

    // Recompute authoritative match score
    await this.scoring.recomputeMatchScore(ex.match_id);

    return data;
  }

  async approveFrozenExchangeEdit(
    request: {
      id: string;
      exchange_id: string;
      request_type: 'void_exchange' | 'revert_void_exchange';
      reason: string;
    },
    actorUserId: string,
  ) {
    const result =
      request.request_type === 'void_exchange'
        ? await this.voidExchange(
            request.exchange_id,
            { reason: request.reason },
            { userId: actorUserId, bypassFrozenReview: true },
          )
        : await this.revertVoidExchange(request.exchange_id, {
            userId: actorUserId,
            bypassFrozenReview: true,
          });
    return result;
  }

  async clearLastExchange(matchId: string, dto: VoidExchangeDto, context?: MatchActor) {
    await this.assertMatchUnlocked(matchId, context);
    const { data: exchange, error } = await this.supabase.service
      .from('exchanges')
      .select('id, match_id, voided')
      .eq('match_id', matchId)
      .eq('voided', false)
      .order('sequence', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!exchange) throw new NotFoundException('No exchange to clear');
    return this.voidExchange((exchange as { id: string }).id, dto, context);
  }

  async editExchange(exchangeId: string, dto: EditExchangeDto, context?: MatchActor) {
    const { data: original, error: fetchError } = await this.supabase.service
      .from('exchanges')
      .select('*')
      .eq('id', exchangeId)
      .maybeSingle();
    if (fetchError) throw new BadRequestException(fetchError.message);
    if (!original) throw new NotFoundException(`Exchange ${exchangeId} not found`);
    const row = original as Record<string, unknown>;
    if (row['voided']) throw new BadRequestException('Exchange is already voided');
    const matchId = row['match_id'] as string;
    await this.assertMatchUnlocked(matchId, context);

    const { redDelta, blueDelta } = this.computeDeltas({
      clientUuid: randomUUID(),
      sequence: Number(row['sequence'] ?? 1),
      type: dto.type,
      occurredAt: new Date().toISOString(),
      firstStrikerColor: dto.firstStrikerColor,
      firstStrikeValue: dto.firstStrikeValue,
      afterblowValue: dto.afterblowValue,
      noExchangeReason: dto.noExchangeReason,
    });

    await this.supabase.service
      .from('exchanges')
      .update({
        voided: true,
        voided_reason: dto.reason ?? 'edited',
      })
      .eq('id', exchangeId);

    const sequence = await this.nextExchangeSequence(matchId);
    const { data, error } = await this.supabase.service
      .from('exchanges')
      .insert({
        client_uuid: randomUUID(),
        match_id: matchId,
        sequence,
        type: dto.type,
        occurred_at: new Date().toISOString(),
        recorded_at: new Date().toISOString(),
        duration_since_prev_ms: row['duration_since_prev_ms'] ?? null,
        first_striker_color: dto.firstStrikerColor ?? null,
        first_strike_value: dto.firstStrikeValue ?? null,
        afterblow_value: dto.afterblowValue ?? null,
        no_exchange_reason: dto.noExchangeReason ?? null,
        red_score_delta: redDelta,
        blue_score_delta: blueDelta,
        staff_account_id: context?.staffAccountId ?? null,
        corrected_exchange_id: exchangeId,
        correction_reason: dto.reason ?? null,
        voided: false,
      })
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    await this.scoring.recomputeMatchScore(matchId);
    return data;
  }

  async swapFighterColor(matchId: string, context?: MatchActor) {
    const match = await this.getLockableMatch(matchId);
    await this.assertMatchUnlocked(matchId, context, match);
    const updates = {
      red_registration_id: match.blue_registration_id,
      blue_registration_id: match.red_registration_id,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await this.supabase.service
      .from('matches')
      .update(updates)
      .eq('id', matchId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    const { data: exchanges, error: exchangeError } = await this.supabase.service
      .from('exchanges')
      .select('id, first_striker_color')
      .eq('match_id', matchId);
    if (exchangeError) throw new BadRequestException(exchangeError.message);
    for (const exchange of exchanges ?? []) {
      const row = exchange as { id: string; first_striker_color: string | null };
      const next =
        row.first_striker_color === 'red'
          ? 'blue'
          : row.first_striker_color === 'blue'
            ? 'red'
            : null;
      if (next) {
        await this.supabase.service
          .from('exchanges')
          .update({ first_striker_color: next })
          .eq('id', row.id);
      }
    }
    await this.scoring.recomputeMatchScore(matchId);
    return data;
  }

  async swapFighterSide(matchId: string, context?: MatchActor) {
    const match = await this.getLockableMatch(matchId);
    await this.assertMatchUnlocked(matchId, context, match);
    const next = match.side_order === 'blue_left' ? 'red_left' : 'blue_left';
    const { data, error } = await this.supabase.service
      .from('matches')
      .update({ side_order: next, updated_at: new Date().toISOString() })
      .eq('id', matchId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async resetMatch(matchId: string, dto: ResetMatchDto, context?: MatchActor) {
    if (dto.confirmation !== 'RESET MATCH') {
      throw new BadRequestException('Confirmation phrase must be RESET MATCH');
    }
    await this.assertMatchUnlocked(matchId, context);
    const reason = dto.reason ?? 'match reset';
    await this.supabase.service
      .from('exchanges')
      .update({ voided: true, voided_reason: reason })
      .eq('match_id', matchId)
      .eq('voided', false);
    await this.supabase.service
      .from('match_penalties')
      .update({ voided: true, voided_reason: reason })
      .eq('match_id', matchId)
      .eq('voided', false);
    await this.insertMatchEvent(matchId, 'reset_match', reason, context);
    const { data, error } = await this.supabase.service
      .from('matches')
      .update({
        status: 'scheduled',
        red_score: 0,
        blue_score: 0,
        winner_registration_id: null,
        started_at: null,
        ended_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', matchId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async lockMatch(
    matchId: string,
    reason: string | undefined,
    context?: MatchActor,
    source: 'manual' | 'auto' = 'manual',
  ) {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase.service
      .from('matches')
      .update({
        locked_at: now,
        locked_by_user_id: context?.userId ?? null,
        locked_by_staff_account_id: context?.staffAccountId ?? null,
        lock_source: source,
        lock_reason: reason ?? null,
        updated_at: now,
      })
      .eq('id', matchId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async unlockMatch(matchId: string, context?: MatchActor) {
    if (!context?.canOverrideLocked) throw new BadRequestException('Organizer permission required');
    const { data, error } = await this.supabase.service
      .from('matches')
      .update({
        locked_at: null,
        locked_by_user_id: null,
        locked_by_staff_account_id: null,
        lock_source: null,
        lock_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', matchId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private computeDeltas(dto: CreateExchangeDto): { redDelta: number; blueDelta: number } {
    let redDelta = 0;
    let blueDelta = 0;

    switch (dto.type) {
      case 'clean':
        if (dto.firstStrikerColor === 'red') redDelta = dto.firstStrikeValue ?? 0;
        else if (dto.firstStrikerColor === 'blue') blueDelta = dto.firstStrikeValue ?? 0;
        break;
      case 'afterblow':
        if (dto.firstStrikerColor === 'red') {
          redDelta = dto.firstStrikeValue ?? 0;
          blueDelta = dto.afterblowValue ?? 0;
        } else if (dto.firstStrikerColor === 'blue') {
          blueDelta = dto.firstStrikeValue ?? 0;
          redDelta = dto.afterblowValue ?? 0;
        }
        break;
      case 'double':
      case 'no_exchange':
        break;
    }

    return { redDelta, blueDelta };
  }

  private async assertMatchUnlocked(
    matchId: string,
    context?: MatchActor,
    existing?: Record<string, unknown>,
  ) {
    const match = existing ?? (await this.getLockableMatch(matchId));
    if (match['locked_at'] && !context?.canOverrideLocked) {
      throw new BadRequestException('Match is locked');
    }
  }

  private async getLockableMatch(matchId: string): Promise<Record<string, unknown>> {
    const { data, error } = await this.supabase.service
      .from('matches')
      .select('id, red_registration_id, blue_registration_id, side_order, locked_at')
      .eq('id', matchId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Match ${matchId} not found`);
    return data as Record<string, unknown>;
  }

  private async nextExchangeSequence(matchId: string): Promise<number> {
    const { data } = await this.supabase.service
      .from('exchanges')
      .select('sequence')
      .eq('match_id', matchId)
      .order('sequence', { ascending: false })
      .limit(1)
      .maybeSingle();
    return ((data as { sequence?: number } | null)?.sequence ?? 0) + 1;
  }

  private async insertMatchEvent(
    matchId: string,
    type: string,
    reason: string,
    context?: MatchActor,
  ): Promise<void> {
    const { data: lastEvent } = await this.supabase.service
      .from('match_events')
      .select('sequence')
      .eq('match_id', matchId)
      .order('sequence', { ascending: false })
      .limit(1)
      .maybeSingle();
    await this.supabase.service.from('match_events').insert({
      match_id: matchId,
      sequence: ((lastEvent as { sequence?: number } | null)?.sequence ?? 0) + 1,
      type,
      reason,
      by_user_id: context?.userId ?? null,
      staff_account_id: context?.staffAccountId ?? null,
      occurred_at: new Date().toISOString(),
    });
  }
}
