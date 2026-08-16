import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { bracketToken, computeAfterblowDeltas, type AfterblowMode } from '@myclash/types';
import { getEffectiveBestOf, normalizeMatchFormatConfig } from '@myclash/rulesets';
import type { Match as RulesetMatch } from '@myclash/rulesets';
import { MatchAlertRefresherService } from '../notifications/match-alert-refresher.service';
import { SupabaseService } from '../supabase/supabase.service';
import { insertAuditLog } from '../../common/audit-log';
import { buildRoundCode, bracketCodeConfig } from './round-code.helper';
import { findLiceCollisions, liceCollisionMessage } from './lice-occupancy';
import { fetchRefereeAssignmentIndex } from './referee-assignment-index';
import { refereeNamesOnly, resolveMatchReferees } from './resolve-match-referees';
import { ScoringService } from './scoring.service';
import { FrozenResultsGuard } from './frozen-results.guard';
import { unplayedMatchColumns } from './unplayed-match-columns';
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

/**
 * Structurally `ScoringActor`. Kept local so this service does not import
 * StaffModule's surface, but it must declare every field it forwards: the
 * discard capability travels from the controller through here into
 * `onMatchUncompleted`, and leaving it off the type made the code read as if it
 * could never arrive.
 */
type MatchActor = {
  userId?: string;
  staffAccountId?: string;
  canOverrideLocked?: boolean;
  canDiscardDependentResults?: boolean;
};

@Injectable()
export class MatchesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly scoring: ScoringService,
    private readonly matchAlerts: MatchAlertRefresherService,
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

    // The round on its own, for the pad's "Tournament · Phase · Piste" line.
    // That line only ever carried poolName, so a bracket or Swiss bout named no
    // phase at all. Built from the same inputs as the code above so the header
    // and the code on the same screen cannot disagree.
    const roundToken =
      row.swiss_round !== null && row.swiss_round !== undefined
        ? `S${row.swiss_round}`
        : bracketToken({ bracketRound: row.bracket_round, bracketSize, wbRounds, lbRounds });

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
      roundToken,
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
   *
   * The event-wide load lives in `fetchRefereeAssignmentIndex` so the per-lice
   * list can resolve a whole day off one copy of it. Names are composed the
   * same way there as they were inline here, so this payload is unchanged.
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

    const assignments = await fetchRefereeAssignmentIndex(this.supabase.service, eventId);
    // `referees: string[]` is a PUBLIC field on GET /matches/:id/summary, joined
    // straight into a sentence by the public match page. `refereeNamesOnly`
    // re-dedupes by name — the resolver now keys on (name, role), so a person
    // with two roles would otherwise appear twice in that sentence.
    return refereeNamesOnly(resolveMatchReferees(assignments, { matchId, poolId, liceId }));
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

  async updateStatus(matchId: string, dto: UpdateMatchStatusDto, context?: MatchActor) {
    return this.setStatus(matchId, dto.status, {
      winnerRegistrationId: dto.winnerRegistrationId,
      discardDependents: dto.discardDependentResults === true,
      context,
    });
  }

  /**
   * Void a match — the only door out of a completed bout other than a reset.
   *
   * `'voided'` used to be a member of `UpdateMatchStatusDto`, which made
   * `PATCH /status` a second door to the same destructive place, gated at
   * scorekeeper while this route is gated at organizer. An assigned pad staff
   * token could reach it. One door, one gate.
   */
  async voidMatch(matchId: string, context?: MatchActor, discardDependents = false) {
    return this.setStatus(matchId, 'voided', { discardDependents, context });
  }

  /**
   * The one write that moves a match between statuses, and the two side effects
   * that hang off the ends of it.
   *
   * UN-COMPLETION FIRST. Any target but 'completed' takes a bout out of the
   * bracket it fed, and that is owned before the write so a refusal leaves the
   * row alone. There is no transaction, so ordering is the guarantee.
   *
   * COMPLETION AWAITED. The comment this replaces justified a fire-and-forget by
   * claiming the endpoint was only reachable from the e2e specs — which
   * `voidMatch` had already falsified by routing through it. An unobserved
   * failure there is a bracket that silently did not advance, in front of a
   * caller about to act on the response.
   */
  private async setStatus(
    matchId: string,
    status: UpdateMatchStatusDto['status'] | 'voided',
    opts: {
      winnerRegistrationId?: string;
      discardDependents: boolean;
      context?: MatchActor;
    },
  ) {
    const updates: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (status === 'running') updates['started_at'] = new Date().toISOString();
    if (status === 'completed') {
      updates['ended_at'] = new Date().toISOString();
      if (opts.winnerRegistrationId) {
        updates['winner_registration_id'] = opts.winnerRegistrationId;
      }
    }

    if (status !== 'completed') {
      await this.uncomplete(
        matchId,
        `match status set to ${status}`,
        opts.context,
        opts.discardDependents,
      );
    }

    const { data, error } = await this.supabase.service
      .from('matches')
      .update(updates)
      .eq('id', matchId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);

    if (status === 'completed') {
      await this.matchCompletion?.onMatchCompleted(matchId);
    }

    return data;
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

    const { data, error } = await this.supabase.service
      .from('matches')
      .update({ lice_id: null, scheduled_at: null, updated_at: new Date().toISOString() })
      .eq('pool_id', poolId)
      .gte('scheduled_at', start)
      .lt('scheduled_at', end)
      // The ids are only reachable from the write itself: the filter is a day
      // window over the times this statement is about to erase, so reading them
      // back afterwards would match nothing.
      .select('id');
    if (error) throw new BadRequestException(error.message);
    await this.matchAlerts.refresh(((data ?? []) as Array<{ id: string }>).map((row) => row.id));
  }

  /**
   * Place one bout on a piste at a time — the schedule grid's drag.
   *
   * Refuses a placement that double-books the piste. This route picks BOTH
   * halves of a slot, so a collision means the caller chose a taken one; the
   * piste-only writers (`update`, `setPoolLice`, venues) are deliberately not
   * guarded, because "assign pistes now, fix the clock after" is a real
   * two-step workflow and refusing step one would break it.
   */
  async scheduleMatch(matchId: string, liceId: string | null, scheduledAt: string | null) {
    await this.assertLiceFree(matchId, liceId || null, scheduledAt || null);

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
    // Through the refresher rather than the two schedulers directly. This was
    // the only write in the API that told the queue anything, and it still got
    // it half right for months — it cancelled the fighter's own alert on an
    // unschedule and left their followers'. One call cannot be half-remembered.
    await this.matchAlerts.refresh([matchId]);
    return data;
  }

  /**
   * Refuse a single-bout placement that lands on an occupied piste.
   *
   * Reads only the day's other bouts on that strip — a bounded window keyed on
   * the piste, not a whole-event scan. The moving bout is excluded by
   * `findLiceCollisions` itself, so re-saving a bout where it already sits
   * cannot refuse.
   */
  private async assertLiceFree(
    matchId: string,
    liceId: string | null,
    scheduledAt: string | null,
  ): Promise<void> {
    // Clearing either half releases the strip; nothing to check.
    if (!liceId || !scheduledAt) return;

    const { data, error } = await this.supabase.service
      .from('matches')
      .select('id, lice_id, scheduled_at')
      .eq('lice_id', liceId)
      .not('scheduled_at', 'is', null)
      .not('status', 'eq', 'voided');
    if (error) throw new BadRequestException(error.message);

    const collisions = findLiceCollisions(
      [{ matchId, liceId, scheduledAt }],
      (
        (data ?? []) as Array<{ id: string; lice_id: string | null; scheduled_at: string | null }>
      ).map((row) => ({
        matchId: row.id,
        liceId: row.lice_id,
        scheduledAt: row.scheduled_at,
      })),
    );
    if (collisions.length > 0) throw new ConflictException(liceCollisionMessage(collisions));
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
   *
   * HARD RULE 8. A fighter may not referee their own fight, and that rule has no
   * off switch. The assignment board enforced it on its own manual path and this
   * route — the one the pool tab's matches table actually uses — enforced
   * nothing, so the rule held on one door and not the other.
   */
  async setRefereeRoleAssignment(
    matchId: string,
    role: string,
    refereeId: string | null,
  ): Promise<{ matchId: string; role: string; refereeId: string | null }> {
    // 1. Load the match and resolve its event via phases → tournaments.event_id
    //    (the `phases` table has no event_id column of its own — it keys on
    //    tournament_id, and the event is reached one hop further up). The two
    //    registration ids come back on the same read: rule 8 is about them, and
    //    a second round trip for two columns already in hand is waste.
    const { data: match, error: matchErr } = await this.supabase.service
      .from('matches')
      .select('red_registration_id, blue_registration_id, phases ( tournaments ( event_id ) )')
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

    // 2. Hard rule 8, before anything is written. Checked on the way IN rather
    //    than as a filter on the way out: a refusal has to reach the operator
    //    who picked the name, not disappear into a log.
    if (refereeId !== null) {
      const matchRow = match as Record<string, unknown>;
      await this.assertRefereeIsNotFighting(refereeId, [
        matchRow['red_registration_id'] as string | null,
        matchRow['blue_registration_id'] as string | null,
      ]);
    }

    // 3. Idempotent clear — delete any existing assignment for the
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

  /**
   * Refuse a referee who is one of the two fighters in the bout.
   *
   * ONE ID-SPACE. `referee_assignments.person_id` points at `global_persons`. A
   * registration reaches that same space through `persons.global_person_id` —
   * NOT `persons.id`, which is the per-event identity and a different space
   * entirely. Comparing the wrong one yields a guard that never matches and
   * therefore never fires, which reads exactly like a guard that works. That is
   * the Denis-Allaume bug, and `referee-match-assignments.ts` carries the same
   * note for the same reason.
   *
   * An unresolvable registration is skipped, never compared under an empty id:
   * two people we cannot identify must not collapse onto one key and refuse each
   * other.
   */
  private async assertRefereeIsNotFighting(
    refereeId: string,
    registrationIds: readonly (string | null)[],
  ): Promise<void> {
    const ids = registrationIds.filter((id): id is string => Boolean(id));
    if (ids.length === 0) return;

    const { data, error } = await this.supabase.service
      .from('registrations')
      .select('id, persons ( global_person_id )')
      .in('id', ids);
    if (error) throw new BadRequestException(error.message);

    for (const row of (data ?? []) as Array<{ persons?: unknown }>) {
      const person = Array.isArray(row.persons)
        ? ((row.persons[0] as Record<string, unknown>) ?? null)
        : ((row.persons as Record<string, unknown>) ?? null);
      const globalPersonId = person?.['global_person_id'] as string | null | undefined;
      if (globalPersonId && globalPersonId === refereeId) {
        throw new BadRequestException('A fighter cannot referee their own match');
      }
    }
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
    // A piste change is an alert change. The queued body names the piste as
    // well as the time — frozen at enqueue — so moving a fight between pistes
    // without moving it in the clock leaves the alert naming the wrong one,
    // with a time that is still correct. Nothing about that looks broken.
    //
    // Only on a piste write. `referee_id` here is the legacy single-referee
    // column; no alert body is built from it, and the referee's own alert comes
    // off `referee_assignments`.
    if (dto.liceId !== undefined) await this.matchAlerts.refresh([matchId]);
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

  /**
   * Put a bout back to unplayed so it can be fought again.
   *
   * FOUR WRITES, NO TRANSACTION, ALL CHECKED. Each silent failure leaves a
   * different half-reset bout: live exchanges that recompute the old score,
   * penalties that still count, or — worst — no `reset_match` event, which is
   * the only thing that returns the derived clock to `idle`. Without it the
   * clock replays as `ended` and `VALID_TRANSITIONS.ended` is `['reopen']`, so
   * the bout reads `scheduled` to every list and cannot be started at all.
   *
   * `end_reason` AND THE DURATIONS. Nothing clears them on the way back in: the
   * clock's `end` writes status, ended_at and the durations but never the
   * reason, and scoring writes it only inside `justCompleted`. A bout reset
   * after a double cap and re-fought to a clock end would stay `completed`
   * carrying 'max_doubles' — which `swiss-standings.service.ts` reads as
   * ['loss','loss'] and the HEMA Ratings submission documents the same way, so
   * both fighters lose a bout one of them just won, in the export that leaves
   * the platform. Same class of miss as the hole `restoreMatchState` was fixed
   * for.
   *
   * THE LOCK. A reset exists to make the bout playable, and a lock is the one
   * thing that stops it being played. Nothing else would ever clear it —
   * MatchAutoLockService only ever ADDS locks, and its group gate needs every
   * match in the group completed or voided, which a freshly reset one is not,
   * so it skips the group from then on. Safe because `assertMatchUnlocked` has
   * already refused this call unless the actor holds `canOverrideLocked`, the
   * same authority `unlockMatch` demands; these are its five columns.
   *
   * THE FORFEIT is voided by the un-completion owner, not here — `uncomplete`
   * below reaches it, and it does the same for every bout the cascade reverts.
   * It voids only records whose whole effect was their own bout, and REFUSES
   * when one withdrew the fighter or spawned child auto-forfeits, naming
   * `PATCH /match-forfeits/:id/void` as the remedy. That refusal is why this
   * call can return a 409 it never used to.
   */
  async resetMatch(matchId: string, dto: ResetMatchDto, context?: MatchActor) {
    if (dto.confirmation !== 'RESET MATCH') {
      throw new BadRequestException('Confirmation phrase must be RESET MATCH');
    }
    await this.assertMatchUnlocked(matchId, context);
    const reason = dto.reason ?? 'match reset';
    // BEFORE the writes below, so a refusal leaves the bout untouched and the
    // bracket still names the result that is about to be undone — which is what
    // the dependent walk resolves through.
    await this.uncomplete(matchId, reason, context, dto.discardDependentResults === true);
    const voidedExchanges = await this.supabase.service
      .from('exchanges')
      .update({ voided: true, voided_reason: reason })
      .eq('match_id', matchId)
      .eq('voided', false);
    if (voidedExchanges.error) throw new BadRequestException(voidedExchanges.error.message);
    const voidedPenalties = await this.supabase.service
      .from('match_penalties')
      .update({ voided: true, voided_reason: reason })
      .eq('match_id', matchId)
      .eq('voided', false);
    if (voidedPenalties.error) throw new BadRequestException(voidedPenalties.error.message);
    await this.insertMatchEvent(matchId, 'reset_match', reason, context);
    const { data, error } = await this.supabase.service
      .from('matches')
      .update(unplayedMatchColumns())
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

  /**
   * Hand a bout that is ceasing to be completed to the single owner of that
   * event, if it is completed at all.
   *
   * Gated on the CURRENT row rather than on the caller's intent: a bout that was
   * never completed propagated nothing, so there is nothing to undo and no
   * reason to make the operator answer for dependents that cannot exist.
   *
   * `onMatchUncompleted` throws on purpose — 409 when a later bout has been
   * fought and nobody has accepted the loss, 403 when the actor may not accept
   * it. Those must reach the caller, so this is deliberately NOT wrapped in a
   * catch the way the completion side effects are.
   */
  private async uncomplete(
    matchId: string,
    reason: string,
    context: MatchActor | undefined,
    discardDependents: boolean,
  ): Promise<void> {
    const { data } = await this.supabase.service
      .from('matches')
      .select('status')
      .eq('id', matchId)
      .maybeSingle();
    if ((data as { status?: string } | null)?.status !== 'completed') return;
    await this.matchCompletion?.onMatchUncompleted(matchId, {
      actor: context,
      discardDependents,
      reason,
    });
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
    // Checked, for the reason ClockService already gives at its identical
    // insert: clock state is replayed from these rows and never stored, so an
    // unchecked failure here returns HTTP 200 over a clock that did not change.
    // `reset_match` is the only event that returns the replay to `idle`.
    const { error } = await this.supabase.service.from('match_events').insert({
      match_id: matchId,
      sequence: ((lastEvent as { sequence?: number } | null)?.sequence ?? 0) + 1,
      type,
      reason,
      by_user_id: context?.userId ?? null,
      staff_account_id: context?.staffAccountId ?? null,
      occurred_at: new Date().toISOString(),
    });
    if (error) throw new BadRequestException(error.message);
  }
}
