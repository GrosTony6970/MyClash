import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { computeAfterblowDeltas, type AfterblowMode } from '@myclash/types';
import { getEffectiveBestOf, normalizeMatchFormatConfig } from '@myclash/rulesets';
import type { Match as RulesetMatch } from '@myclash/rulesets';
import { FollowNotificationSchedulerService } from '../../workers/follow-notification-scheduler.worker';
import { NotificationSchedulerService } from '../../workers/notification-scheduler.worker';
import { SupabaseService } from '../supabase/supabase.service';
import { insertAuditLog } from '../../common/audit-log';
import { buildRoundCode, bracketCodeConfig } from './round-code.helper';
import { resolveMatchReferees } from './resolve-match-referees';
import { ScoringService } from './scoring.service';
import { FrozenResultsGuard } from './frozen-results.guard';
// Value import (not `import type`): this is a NestJS DI dependency. A type-only
// import is erased at runtime, so `design:paramtypes` emits `Object`, the
// @Optional() param silently resolves to `undefined`, and every completion side
// effect stops firing without a word. Keep it a value import.
import { MatchCompletionService } from '../phases/match-completion.service';
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
    @Optional() private readonly matchCompletion?: MatchCompletionService,
  ) {}

  private readonly logger = new Logger(MatchesService.name);

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
        'match_id, match_number_label, status, pool_id, pool_name, bracket_round, swiss_round, red_name, blue_name, red_club, blue_club, tournament_id, event_id, phase_id, phase_type',
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
      swiss_round: number | null;
      red_name: string | null;
      blue_name: string | null;
      red_club: string | null;
      blue_club: string | null;
      tournament_id: string;
      event_id: string;
      phase_id: string | null;
      phase_type: string | null;
    };

    // Fetch weapon + ruleset_config from tournament (not in view). ruleset_config
    // drives the effective best-of for this match's phase.
    const { data: tournament } = await this.supabase.service
      .from('tournaments')
      .select('weapon, name, ruleset_config, scoring_config_json')
      .eq('id', row.tournament_id)
      .maybeSingle();
    const weapon = (tournament as { weapon?: string | null } | null)?.weapon ?? null;
    const tournamentName = (tournament as { name?: string | null } | null)?.name ?? null;
    // The operator's configured side colours live here. Returned so the PUBLIC
    // match page paints the tournament's real colours instead of falling back
    // to generic red/blue — the pad and the projector already do.
    const scoringConfig =
      (tournament as { scoring_config_json?: unknown } | null)?.scoring_config_json ?? null;
    const rulesetConfig = (tournament as { ruleset_config?: unknown } | null)?.ruleset_config ?? {};
    const matchFormat = normalizeMatchFormatConfig(
      (rulesetConfig as { matchFormat?: unknown }).matchFormat ?? {},
    );
    const summaryPhaseType =
      row.phase_type === 'pool' ||
      row.phase_type === 'single_elim' ||
      row.phase_type === 'double_elim' ||
      row.phase_type === 'swiss'
        ? row.phase_type
        : undefined;
    const bestOf = getEffectiveBestOf(
      {
        id: matchId,
        redRegistrationId: '',
        blueRegistrationId: '',
        rulesetCode: 'TF_v1',
        rulesetVersion: '1.0.0',
        status: 'running',
        phaseType: summaryPhaseType,
        matchNumberLabel: row.match_number_label,
      } satisfies RulesetMatch,
      matchFormat,
    );

    // For bracket matches, fetch the phase's bracketSize so the
    // formatter resolves bracket_round → R16/QF/SF/F instead of
    // falling back to B{round}. Stored at bracket-generation time in
    // phases.config_json.
    let bracketSize: number | null = null;
    // Double-elim split, from the same config blob — without it the winners
    // final, the grand final and its reset would all render the same label.
    let wbRounds: number | null = null;
    let lbRounds: number | null = null;
    if (row.bracket_round !== null && row.phase_id) {
      const { data: phaseRow } = await this.supabase.service
        .from('phases')
        .select('config_json')
        .eq('id', row.phase_id)
        .maybeSingle();
      const cfg = (phaseRow as { config_json?: Record<string, unknown> } | null)?.config_json;
      const size = (cfg?.['bracketSize'] ?? cfg?.['mainBracketSize']) as number | undefined;
      if (typeof size === 'number') bracketSize = size;
      ({ wbRounds, lbRounds } = bracketCodeConfig(cfg));
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
      swissRound: row.swiss_round,
      bracketSize,
      wbRounds,
      lbRounds,
      matchNumberLabel: row.match_number_label,
      roundNumber: null,
    });

    // Event timezone — so the public match view can format started/ended
    // times in the venue's wall clock (default Europe/Paris).
    const { data: eventRow } = await this.supabase.service
      .from('events')
      .select('timezone')
      .eq('id', row.event_id)
      .maybeSingle();
    const eventTimezone =
      (eventRow as { timezone?: string | null } | null)?.timezone ?? 'Europe/Paris';

    const referees = await this.resolveMatchRefereesForSummary(row.event_id, matchId, row.pool_id);

    // Piste/lice display name for the scoreboard header context line
    // (Tournament · Pool · Piste). lice_id lives on the match row, not the view.
    const { data: matchLiceRow } = await this.supabase.service
      .from('matches')
      .select(
        'lice_id, current_round, red_round_wins, blue_round_wins, rounds_json, awaiting_round_advance',
      )
      .eq('id', matchId)
      .maybeSingle();
    const matchRoundRow = matchLiceRow as {
      lice_id?: string | null;
      current_round?: number | null;
      red_round_wins?: number | null;
      blue_round_wins?: number | null;
      rounds_json?: unknown;
      awaiting_round_advance?: boolean | null;
    } | null;
    const summaryLiceId = matchRoundRow?.lice_id ?? null;
    let liceName: string | null = null;
    if (summaryLiceId) {
      const { data: lice } = await this.supabase.service
        .from('lices')
        .select('name')
        .eq('id', summaryLiceId)
        .maybeSingle();
      liceName = (lice as { name?: string | null } | null)?.name ?? null;
    }

    return {
      matchLabel: row.match_number_label ?? '',
      roundCode,
      status: row.status,
      poolName: row.pool_name ?? '',
      tournamentName: tournamentName ?? '',
      liceName: liceName ?? '',
      redName: row.red_name ?? '',
      redClub: row.red_club ?? null,
      blueName: row.blue_name ?? '',
      blueClub: row.blue_club ?? null,
      eventTimezone,
      referees,
      weapon: weapon ?? '',
      // Surface tournamentId + phaseType so the cross-app scoring
      // pad can fetch the right scoring config + drive phase-specific
      // ScoringPad behaviour when deep-linking to a match directly
      // (per-match route, no lice context).
      tournamentId: row.tournament_id,
      phaseType: row.phase_type ?? null,
      // The scoring rules the page needs to render a score correctly:
      // matchFormat carries the point cap, the scoring direction and the double
      // cap (already resolved above for bestOf), scoringConfig the operator's
      // side colours. Both were computed/fetched here and thrown away.
      matchFormat,
      scoringConfig,
      // Best-of-N round state. bestOf = 1 (single round) for unconfigured
      // tournaments, so the scoreboard hides the round counter by default.
      bestOf,
      currentRound: matchRoundRow?.current_round ?? 1,
      redRoundWins: matchRoundRow?.red_round_wins ?? 0,
      blueRoundWins: matchRoundRow?.blue_round_wins ?? 0,
      roundsJson: Array.isArray(matchRoundRow?.rounds_json) ? matchRoundRow?.rounds_json : null,
      awaitingRoundAdvance: matchRoundRow?.awaiting_round_advance ?? false,
    };
  }

  /**
   * Referee name(s) officiating a match, by scope precedence
   * match → pool → lice (see resolveMatchReferees). Post-0063 assignments
   * key on `person_id`, resolved to a display name via `global_persons`.
   */
  private async resolveMatchRefereesForSummary(
    eventId: string,
    matchId: string,
    poolId: string | null,
  ): Promise<string[]> {
    // The match's lice — for lice-scope assignments (last-resort tier).
    const { data: matchRow } = await this.supabase.service
      .from('matches')
      .select('lice_id')
      .eq('id', matchId)
      .maybeSingle();
    const liceId = (matchRow as { lice_id?: string | null } | null)?.lice_id ?? null;

    const { data: assignmentRows } = await this.supabase.service
      .from('referee_assignments')
      .select('scope_type, match_id, pool_id, lice_id, person_id, status')
      .eq('event_id', eventId)
      .in('status', ['assigned', 'confirmed', 'pending']);
    const assignments = (assignmentRows ?? []) as Array<{
      scope_type: string;
      match_id: string | null;
      pool_id: string | null;
      lice_id: string | null;
      person_id: string | null;
    }>;
    if (assignments.length === 0) return [];

    const personIds = Array.from(
      new Set(assignments.map((a) => a.person_id).filter((id): id is string => !!id)),
    );
    const nameById = new Map<string, string>();
    if (personIds.length > 0) {
      const { data: personRows } = await this.supabase.service
        .from('global_persons')
        .select('id, given_name, family_name')
        .in('id', personIds);
      for (const p of (personRows ?? []) as Array<{
        id: string;
        given_name: string | null;
        family_name: string | null;
      }>) {
        const name = `${(p.given_name ?? '').trim()} ${(p.family_name ?? '').trim()}`.trim();
        if (name) nameById.set(p.id, name);
      }
    }

    return resolveMatchReferees(
      assignments.map((a) => ({
        scopeType: a.scope_type,
        matchId: a.match_id,
        poolId: a.pool_id,
        liceId: a.lice_id,
        name: a.person_id ? (nameById.get(a.person_id) ?? '') : '',
      })),
      { matchId, poolId, liceId },
    );
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

    // One owner for every completion side effect (advance + pool auto-populate).
    // Fire-and-forget here, unlike the pad's paths: this endpoint is only used by
    // the e2e specs, which poll for the result anyway.
    if (dto.status === 'completed') {
      void this.matchCompletion?.onMatchCompleted(matchId);
    }

    return data;
  }

  async voidMatch(matchId: string) {
    return this.updateStatus(matchId, { status: 'voided' });
  }

  /**
   * Bulk-clear every match of one pool that's scheduled on a specific
   * calendar day. Backs the "Clear pool" action surfaced on the schedule
   * grid: the operator wants to wipe an accidentally-misplaced pool
   * without losing the rest of the day's plan.
   *
   * Day is matched in UTC against `[YYYY-MM-DDT00:00:00Z, next day)` —
   * same convention the FE uses to decide which day a match belongs to.
   */
  async clearPoolScheduleForDay(poolId: string, dayIso: string) {
    const start = `${dayIso}T00:00:00.000Z`;
    const nextDay = new Date(`${dayIso}T00:00:00.000Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const end = nextDay.toISOString();

    const { error } = await this.supabase.service
      .from('matches')
      .update({ lice_id: null, scheduled_at: null, updated_at: new Date().toISOString() })
      .eq('pool_id', poolId)
      .gte('scheduled_at', start)
      .lt('scheduled_at', end);
    if (error) throw new BadRequestException(error.message);
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
    // 1. Load the match and resolve its event via phases → tournaments.event_id
    //    (the `phases` table has no event_id column of its own — it keys on
    //    tournament_id, and the event is reached one hop further up).
    const { data: match, error: matchErr } = await this.supabase.service
      .from('matches')
      .select('phases ( tournaments ( event_id ) )')
      .eq('id', matchId)
      .maybeSingle();
    if (matchErr) throw new BadRequestException(matchErr.message);
    if (!match) throw new NotFoundException(`Match ${matchId} not found`);
    // PostgREST nests a to-one embed as an object (or a 1-element array). Normalize.
    const one = (v: unknown): Record<string, unknown> | null =>
      Array.isArray(v)
        ? ((v[0] as Record<string, unknown>) ?? null)
        : ((v as Record<string, unknown>) ?? null);
    const phase = one((match as Record<string, unknown>)['phases']);
    const tournament = one(phase?.['tournaments']);
    const eventId = tournament?.['event_id'] as string | undefined;
    if (!eventId) throw new NotFoundException(`Event for match ${matchId} not found`);

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
      // Match-scoped rows MUST be lice-null (referee_assignments_scope_check,
      // migration 0091); lice_id is reserved for the 'lice' scope. The
      // assignment-board engine writes null here too.
      lice_id: null,
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

    // The scoring pad's ExchangeRow is camelCase and the timeline reads
    // clockTimeMs / scoringSide / scoreDelta. Supabase returns raw
    // snake_case, so map additively (spread the raw row + add aliases —
    // the corrections drawer reads only id/sequence/type, so nothing
    // downstream breaks). scoringSide is the striker for clean/afterblow
    // rows; scoreDelta is that striker's delta.
    return (data ?? []).map((row) => {
      const r = row as {
        type: string;
        occurred_at: string;
        clock_time_ms: number | null;
        first_striker_color: 'red' | 'blue' | null;
        red_score_delta: number;
        blue_score_delta: number;
        afterblow_value: number | null;
      };
      const scoringSide =
        r.type === 'clean' || r.type === 'afterblow' ? r.first_striker_color : null;
      const scoreDelta =
        scoringSide === 'red'
          ? r.red_score_delta
          : scoringSide === 'blue'
            ? r.blue_score_delta
            : null;
      // The defender's NETTED afterblow points (the opposite side's delta) —
      // 0 in deductive mode, the raw afterblow value in full. Use the delta,
      // not raw afterblow_value, so the timeline shows the real score impact.
      const defenderDelta =
        r.type === 'afterblow'
          ? scoringSide === 'red'
            ? r.blue_score_delta
            : scoringSide === 'blue'
              ? r.red_score_delta
              : null
          : null;
      return {
        ...r,
        occurredAt: r.occurred_at,
        clockTimeMs: r.clock_time_ms ?? null,
        scoringSide,
        scoreDelta,
        defenderDelta,
      };
    });
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

    // Best-of: a new exchange belongs to the current open round, and scoring is
    // blocked while a round is awaiting advance (the operator must start the next
    // round first). current_round defaults to 1 and awaiting is never set for a
    // single-round match, so this leaves bestOf = 1 behaviour unchanged.
    const { data: matchRoundRow } = await this.supabase.service
      .from('matches')
      .select('current_round, awaiting_round_advance')
      .eq('id', matchId)
      .maybeSingle();
    const roundState = matchRoundRow as {
      current_round?: number | null;
      awaiting_round_advance?: boolean | null;
    } | null;
    if (roundState?.awaiting_round_advance) {
      throw new BadRequestException('Round ended — advance to the next round before scoring');
    }
    const roundNumber = roundState?.current_round ?? 1;

    // Compute netted score deltas for materialized columns (raw afterblow
    // values are still stored below — only the deltas apply the mode).
    const afterblowMode = dto.type === 'afterblow' ? await this.getAfterblowMode(matchId) : 'full';
    const { redDelta, blueDelta } = this.computeDeltas(dto, afterblowMode);

    const insertRow = (sequence: number) =>
      this.supabase.service
        .from('exchanges')
        .insert({
          client_uuid: dto.clientUuid,
          match_id: matchId,
          round_number: roundNumber,
          sequence,
          type: dto.type,
          occurred_at: dto.occurredAt,
          recorded_at: new Date().toISOString(),
          clock_time_ms: dto.clockTimeMs ?? null,
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
    const isUniqueViolation = (message: string) =>
      message.includes('unique') || message.includes('duplicate');

    let { data, error } = await insertRow(dto.sequence);

    if (error && isUniqueViolation(error.message)) {
      // Handle race condition: another request inserted the same client_uuid
      const { data: raceExisting } = await this.supabase.service
        .from('exchanges')
        .select('*')
        .eq('client_uuid', dto.clientUuid)
        .maybeSingle();
      if (raceExisting) return raceExisting;

      // Fresh client_uuid → the collision is on UNIQUE(match_id, sequence): the
      // pad's local counter restarted below the server max (mid-match reload,
      // device swap). The pad's intent is "append", so append at the server's
      // next free sequence — a 400 here is dropped TERMINALLY by the offline
      // outbox and the scored hit would silently vanish.
      for (let attempt = 0; attempt < 3 && error && isUniqueViolation(error.message); attempt++) {
        ({ data, error } = await insertRow(await this.nextExchangeSequence(matchId)));
      }
    }

    if (error) throw new BadRequestException(error.message);

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
      .select('id, match_id, voided, sequence')
      .eq('id', exchangeId)
      .maybeSingle();

    if (fetchError || !exchange) throw new NotFoundException(`Exchange ${exchangeId} not found`);

    const ex = exchange as { id: string; match_id: string; voided: boolean; sequence?: number };
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

    await this.writeExchangeAudit('exchange.voided', ex, context, { reason: dto.reason ?? null });

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
      .select('id, match_id, voided, sequence')
      .eq('id', exchangeId)
      .maybeSingle();

    if (fetchError || !exchange) throw new NotFoundException(`Exchange ${exchangeId} not found`);

    const ex = exchange as { id: string; match_id: string; voided: boolean; sequence?: number };
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

    await this.writeExchangeAudit('exchange.void_reverted', ex, context, {});

    // Recompute authoritative match score
    await this.scoring.recomputeMatchScore(ex.match_id);

    return data;
  }

  /**
   * Record an exchange edit in the audit log.
   *
   * Voiding an exchange changes a published score, so it belongs in the record —
   * but until now only the FROZEN path (exchange_edit_request) wrote anything,
   * leaving every edit on a live event untraceable.
   *
   * A staff account is not an auth user, so `actor_user_id` stays NULL and the
   * staff id rides in the payload rather than being coerced into the UUID column.
   * The write is best-effort: an audit failure must never fail a scoring mutation.
   */
  private async writeExchangeAudit(
    action: 'exchange.voided' | 'exchange.void_reverted',
    exchange: { id: string; match_id: string; sequence?: number },
    context: { userId?: string; staffAccountId?: string } | undefined,
    extra: Record<string, unknown>,
  ): Promise<void> {
    // Best-effort: an audit failure must never fail a scoring mutation. A staff
    // account is not an auth user, so actor stays NULL and the staff id rides in
    // the payload rather than being coerced into a UUID column.
    const { error } = await insertAuditLog(this.supabase.service, {
      actorUserId: context?.userId ?? null,
      action,
      entityType: 'exchange',
      entityId: exchange.id,
      payload: {
        match_id: exchange.match_id,
        sequence: exchange.sequence ?? null,
        staffAccountId: context?.staffAccountId ?? null,
        ...extra,
      },
    });
    if (error) {
      this.logger.warn(`Could not write ${action} audit row: ${error.message}`);
    }
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

    const afterblowMode = dto.type === 'afterblow' ? await this.getAfterblowMode(matchId) : 'full';
    const { redDelta, blueDelta } = this.computeDeltas(
      {
        clientUuid: randomUUID(),
        sequence: Number(row['sequence'] ?? 1),
        type: dto.type,
        occurredAt: new Date().toISOString(),
        firstStrikerColor: dto.firstStrikerColor,
        firstStrikeValue: dto.firstStrikeValue,
        afterblowValue: dto.afterblowValue,
        noExchangeReason: dto.noExchangeReason,
      },
      afterblowMode,
    );

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
        // Keep the correction in the SAME round as the exchange it replaces.
        round_number: (row['round_number'] as number | null) ?? 1,
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
    // Bulk-UPSERT replaces a per-row UPDATE loop: one round-trip
    // regardless of exchange count. Each row maps to a different
    // next colour (some red→blue, some blue→red), so a single
    // .update().eq() won't work — UPSERT with onConflict='id' is
    // the simplest batched form. Rows where first_striker_color is
    // null (or anything other than red/blue) are filtered out
    // before the upsert, matching the prior loop's `if (next)`
    // skip behaviour.
    type ColorRow = { id: string; first_striker_color: string | null };
    const flipPayload = ((exchanges ?? []) as ColorRow[])
      .map((row) => {
        const next =
          row.first_striker_color === 'red'
            ? 'blue'
            : row.first_striker_color === 'blue'
              ? 'red'
              : null;
        return next ? { id: row.id, first_striker_color: next } : null;
      })
      .filter((row): row is { id: string; first_striker_color: string } => row !== null);
    if (flipPayload.length > 0) {
      const { error: flipErr } = await this.supabase.service
        .from('exchanges')
        .upsert(flipPayload, { onConflict: 'id' });
      if (flipErr) {
        throw new BadRequestException(
          `Failed to swap exchange colours for match ${matchId}: ${flipErr.message}`,
        );
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
        // Reset best-of round state back to a single open round.
        current_round: 1,
        red_round_wins: 0,
        blue_round_wins: 0,
        rounds_json: null,
        awaiting_round_advance: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', matchId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /**
   * Advance a best-of match to the next round (delegates to the scoring service,
   * which owns the round lifecycle + clock reset).
   */
  async advanceRound(matchId: string, context?: MatchActor) {
    return this.scoring.advanceRound(matchId, context);
  }

  /** End the current round on time in a best-of match (operator-driven). */
  async endRoundOnTime(matchId: string, context?: MatchActor) {
    return this.scoring.endRoundOnTime(matchId, context);
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

  /**
   * Net per-fighter score deltas for the materialized red/blue_score_delta
   * columns. The raw button values stay on first_strike_value/afterblow_value;
   * these deltas apply the tournament's afterblow mode (deductive subtracts the
   * afterblow from the attacker; the afterblow-lander gains 0).
   */
  private computeDeltas(
    dto: CreateExchangeDto,
    afterblowMode: AfterblowMode = 'full',
  ): { redDelta: number; blueDelta: number } {
    let redDelta = 0;
    let blueDelta = 0;

    switch (dto.type) {
      case 'clean':
        if (dto.firstStrikerColor === 'red') redDelta = dto.firstStrikeValue ?? 0;
        else if (dto.firstStrikerColor === 'blue') blueDelta = dto.firstStrikeValue ?? 0;
        break;
      case 'afterblow': {
        const { attackerDelta, defenderDelta } = computeAfterblowDeltas(
          afterblowMode,
          dto.firstStrikeValue ?? 0,
          dto.afterblowValue ?? 0,
        );
        if (dto.firstStrikerColor === 'red') {
          redDelta = attackerDelta;
          blueDelta = defenderDelta;
        } else if (dto.firstStrikerColor === 'blue') {
          blueDelta = attackerDelta;
          redDelta = defenderDelta;
        }
        break;
      }
      case 'double':
      case 'no_exchange':
        break;
    }

    return { redDelta, blueDelta };
  }

  /**
   * Resolve a match's tournament afterblow mode from scoring_config_json
   * (defaults to 'full'). Used at exchange write to net the materialized
   * score deltas; the raw afterblow values are preserved on the row.
   */
  private async getAfterblowMode(matchId: string): Promise<AfterblowMode> {
    const { data } = await this.supabase.service
      .from('matches')
      .select('phases(tournaments(scoring_config_json))')
      .eq('id', matchId)
      .maybeSingle();
    const phases = (data as { phases?: unknown } | null)?.phases;
    const phase = Array.isArray(phases) ? phases[0] : phases;
    const tournaments = (phase as { tournaments?: unknown } | null)?.tournaments;
    const tournament = Array.isArray(tournaments) ? tournaments[0] : tournaments;
    const scoringConfig = (tournament as { scoring_config_json?: unknown } | null)
      ?.scoring_config_json;
    return (scoringConfig as { afterblowMode?: unknown } | null)?.afterblowMode === 'deductive'
      ? 'deductive'
      : 'full';
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
