/**
 * apps/api/src/modules/matches/clock.service.ts
 *
 * Match clock service — persists clock state as match_events rows.
 * Clock state is always recomputed from the match_events timeline,
 * never stored as a separate field. This makes it lossless and replayable.
 *
 * Clock actions: start | halt | resume | end | reopen | reset_clock
 *
 * Active time = sum of (resume_at - start_at) intervals.
 * Current active time = sum of closed intervals + (now - last_start) if running.
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
// Value import, not `import type`: Nest needs the runtime class for DI metadata.
import { MatchCompletionService } from '../phases/match-completion.service';
import {
  noResultColumns,
  popClinchingRoundColumns,
  reopenedResultColumns,
} from './reopen-match-columns';
import {
  extraTimeAdjustmentMs,
  isLevelBout,
  matchFormatContext,
  timeLimitResult,
} from './time-limit-result';
import { endRefusal } from './level-at-time-refusal';
import { isOver } from '../../common/live-status';
import { eventResultsFrozen } from './event-results-frozen';
import {
  alreadyTrue,
  ClockRowCollided,
  elapsedAt,
  eventStatusOf,
  placeLatePress,
  placedInTimeline,
  pressIsSaved,
  type LatePress,
  type PressAction,
} from './late-press';
import { matchLocked } from './match-locked';
import { roundAwaitsAdvance } from './round-awaits-advance';
import {
  effectiveTimeLimitSeconds,
  pendingLevelStep,
  timeIsFinished,
  type LevelStep,
} from '@myclash/rulesets';
import { CLOCK_ACTIONS_FROM, foldClock } from '@myclash/rules';

export type ClockAction =
  'start' | 'halt' | 'resume' | 'end' | 'reopen' | 'reset_clock' | 'adjust_time' | 'reset_match';

export interface ClockState {
  matchId: string;
  status: 'idle' | 'running' | 'halted' | 'ended';
  /** Total active time in milliseconds (excluding current running interval) */
  activeMs: number;
  /** If running: timestamp when the current interval started */
  runningFrom: string | null;
  /** Computed total active time including current interval (if running) */
  totalActiveMs: number;
  /** Wall-clock origin: ISO timestamp of the first 'start' event; null until match starts; resets on reset_match */
  startedAt: string | null;
  /**
   * How far down the phase's level-at-time chain this bout has been taken —
   * the count of `level_resolution` events since the last `reset_match`.
   *
   * It rides on the clock because the pad reads the clock after every action
   * and the rows are in the same timeline, so it costs no extra query. It is
   * NOT a clock event: the rows are excluded from `events` below, so neither
   * the `ClockAction` union nor the pad's unified timeline widens for it.
   */
  levelResolutionSteps: number;
  events: Array<{
    id: string;
    type: ClockAction;
    occurredAt: string;
    reason: string | null;
    adjustmentMs: number | null;
  }>;
}

/** Who presses, and what they may pass. */
interface ClockActor {
  userId?: string;
  staffAccountId?: string;
  canOverrideLocked?: boolean;
  canDiscardDependentResults?: boolean;
}

/** One clock row to write, once every rule has let it through. */
interface ClockStep {
  action: ClockAction;
  reason?: string;
  actor?: ClockActor;
  /** What an End does to the bout. Null for every other action. */
  ending: ReturnType<typeof timeLimitResult> | null;
  uncompletes: boolean;
  /** A press sent late: its id. */
  press?: { clientUuid: string };
  /**
   * Where the row is placed in the timeline: a press sent late, or the
   * server's own press after a queued hit or card. None: now.
   */
  at?: string;
}

// The scores and the phase's match format are here so `end` can NAME
// the winner of a bout that ran out of time — see `timeLimitResult`.
// `status` is there because a bout already completed is not decided
// again, and `winner_registration_id` because the decision reads the
// LADDER, not the scores. The Event's status is for a press sent late.
const BOUT_COLUMNS =
  'id, status, locked_at, started_at, rounds_json, current_round, ' +
  'red_registration_id, blue_registration_id, winner_registration_id, ' +
  'red_score, blue_score, match_number_label, awaiting_round_advance, ' +
  'phases(type, tournaments(ruleset_config, events(status)))';

/** Postgres: a unique key refused the row. */
const UNIQUE_VIOLATION = '23505';

// Valid transitions: the pad folds its own presses by the same table.
const VALID_TRANSITIONS: Record<string, readonly ClockAction[]> = CLOCK_ACTIONS_FROM;

@Injectable()
export class ClockService {
  private readonly logger = new Logger(ClockService.name);

  constructor(
    private readonly supabase: SupabaseService,
    /** Optional so tests and non-Phases consumers still construct. */
    @Optional() private readonly matchCompletion?: MatchCompletionService,
  ) {}

  // ── Get clock state ───────────────────────────────────────────────────────

  async getClockState(matchId: string): Promise<ClockState> {
    const { data: events, error } = await this.supabase.service
      .from('match_events')
      .select('id, type, reason, occurred_at, adjustment_ms')
      .eq('match_id', matchId)
      // `level_resolution` is read here and NOT folded into the clock: it is
      // how far down the phase's level-at-time chain the bout has been taken,
      // and `computeClockState` counts it out of the list before replaying.
      // One query rather than two, on the read the pad makes after every action.
      .in('type', [
        'start',
        'halt',
        'resume',
        'end',
        'reopen',
        'reset_clock',
        'adjust_time',
        'reset_match',
        'level_resolution',
        // Not a clock event either — it RESETS the chain, because each round of
        // a best-of match is its own bout and works the chain from the top.
        // Without it round 2 opened already in sudden death.
        'round_advance',
      ])
      .order('occurred_at', { ascending: true })
      .order('sequence', { ascending: true });

    if (error) throw new BadRequestException(error.message);

    return this.computeClockState(matchId, events ?? []);
  }

  // ── Clock action ──────────────────────────────────────────────────────────

  async clockAction(
    matchId: string,
    action: ClockAction,
    reason?: string,
    actor?: {
      userId?: string;
      staffAccountId?: string;
      canOverrideLocked?: boolean;
      canDiscardDependentResults?: boolean;
    },
    discardDependents = false,
    /**
     * Of the server's own End or Halt: its time of the hit or the card that
     * decided the bout, when a tablet kept it in a queue (`scoredAtServer`).
     * The row is written there, not at the time the queue arrives.
     */
    causedAt?: string,
  ): Promise<ClockState> {
    // Verify match exists
    const { data: match } = await this.supabase.service
      .from('matches')
      .select(BOUT_COLUMNS)
      .eq('id', matchId)
      .maybeSingle();

    if (!match) throw new NotFoundException(`Match ${matchId} not found`);
    if ((match as { locked_at?: string | null }).locked_at && !actor?.canOverrideLocked) {
      throw matchLocked();
    }

    // Get current state
    const current = await this.getClockState(matchId);

    // Validate transition
    const allowed = VALID_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(action)) {
      throw new BadRequestException(
        `Cannot ${action} clock when status is '${current.status}'. ` +
          `Allowed: ${allowed.length ? allowed.join(', ') : 'none'}`,
      );
    }

    // Between two rounds of a best-of bout nobody fights: the clock does not
    // start there (operator, 2026-10-09). "Start round N+1" opens the round
    // first, and uses a Halt, a Reopen and a Reset only, which pass.
    if (
      (action === 'start' || action === 'resume') &&
      (match as { awaiting_round_advance?: boolean | null }).awaiting_round_advance
    ) {
      throw roundAwaitsAdvance();
    }

    // What ending the clock would do — resolved BEFORE the event row is
    // written, because it can refuse and a refusal must leave the timeline as
    // untouched as the row. `totalActiveMs` rather than `activeMs`: it includes
    // the interval still running, which is the elapsed time the referee is
    // looking at. See `endRefusal` for what a refusal says.
    const ending =
      action === 'end'
        ? timeLimitResult(
            match as unknown as Record<string, unknown>,
            current.levelResolutionSteps,
            current.totalActiveMs,
          )
        : null;
    if (ending && 'refuse' in ending) throw endRefusal(ending.refuse);

    // Four of the six actions write a non-completed status, and the transition
    // table above cannot see that: it is keyed on the clock status replayed from
    // `match_events`, and never reads `matches.status`. A bout completed without
    // an `end` event — every `PATCH /status` completion, every forfeit or point
    // cap on a clock that was never started — has clock status 'idle', so
    // 'start' is legal on it, and 'halt' and 'resume' after that. Only 'reopen'
    // looks like an un-completion; all four are one.
    //
    // Owned once, here, before the event row is written, so a refusal leaves the
    // timeline as well as the row untouched.
    const uncompletes =
      (match as { status?: string }).status === 'completed' &&
      action !== 'end' &&
      action !== 'reset_clock';
    if (uncompletes) {
      await this.matchCompletion?.onMatchUncompleted(matchId, {
        actor,
        discardDependents,
        reason: reason ?? `clock ${action}`,
      });
    }

    const at = causedAt
      ? await placedInTimeline(this.supabase.service, matchId, Date.parse(causedAt))
      : undefined;
    return this.record(matchId, match as unknown as Record<string, unknown>, current, {
      action,
      reason,
      actor,
      ending,
      uncompletes,
      at,
    });
  }

  // ── A press sent late ─────────────────────────────────────────────────────

  /**
   * Take a Start, Halt, Resume or End a pad pressed earlier and sends now.
   * The order of the rules is the design, and `late-press.ts` says why:
   *
   *   1. A press the server holds is answered with the clock. No rule below may
   *      answer it: the pad reads a refusal as "never taken" and sends it for ever.
   *   2. An over Event refuses it with a new hit's refusal, and to everybody:
   *      the clock of an over Event was closed to a super admin too.
   *   3. A press that asks for the state the clock is in is done, and writes
   *      nothing (ruling 12). This is the common case: the hit at the cap ended
   *      the clock before the pad's own End arrived. Before the lock, because
   *      such a bout may be locked by then.
   *   4. The rules of `placeLatePress`, which says where the press goes.
   *   5. A level bout at its time. The End is judged on the time the clock had
   *      run WHEN IT WAS PRESSED.
   *
   * Two writers on one bout: another tablet, or the server's own End, can
   * write a row between these rules and the insert. The insert then fails on
   * the sequence's unique key, and EVERY rule is asked again on the new
   * timeline: the row that won may have ended the clock or the bout. A new
   * sequence alone would write a press nobody judged.
   */
  async latePress(
    matchId: string,
    action: PressAction,
    press: LatePress,
    actor?: ClockActor,
  ): Promise<ClockState> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.takePress(matchId, action, press, actor);
      } catch (refusal) {
        if (!(refusal instanceof ClockRowCollided) || attempt === 3) throw refusal;
      }
    }
  }

  private async takePress(
    matchId: string,
    action: PressAction,
    press: LatePress,
    actor?: ClockActor,
  ): Promise<ClockState> {
    const db = this.supabase.service;
    if (await pressIsSaved(db, press.clientUuid)) return this.getClockState(matchId);
    const { data } = await db.from('matches').select(BOUT_COLUMNS).eq('id', matchId).maybeSingle();
    if (!data) throw new NotFoundException(`Match ${matchId} not found`);
    const match = data as unknown as Record<string, unknown>;
    if (isOver(eventStatusOf(match))) throw eventResultsFrozen();

    const current = await this.getClockState(matchId);
    if (alreadyTrue(action, current.status)) return current;
    const at = await placeLatePress(db, {
      matchId,
      match,
      action,
      press,
      mayPassLock: actor?.canOverrideLocked === true,
      fits: (VALID_TRANSITIONS[current.status] ?? []).includes(action),
      clockStatus: current.status,
    });
    const ending =
      action === 'end'
        ? timeLimitResult(match, current.levelResolutionSteps, elapsedAt(current, at))
        : null;
    if (ending && 'refuse' in ending) throw endRefusal(ending.refuse);

    return this.record(matchId, match, current, {
      action,
      actor,
      ending,
      uncompletes: false,
      press: { clientUuid: press.clientUuid },
      at,
    });
  }

  /**
   * Insert the clock row at the bout's next sequence.
   *
   * The error MUST be checked: an unchecked failed insert would return a
   * recomputed-but-unchanged clock with HTTP 200 — a silent no-op the operator
   * can't diagnose. A press sent late that loses its sequence, or its own id,
   * to another writer says so with `ClockRowCollided`: `latePress` asks again.
   */
  private async insertRow(matchId: string, step: ClockStep, at: string): Promise<void> {
    const sequence = await this.nextSequence(matchId);
    const { error } = await this.supabase.service.from('match_events').insert({
      match_id: matchId,
      sequence,
      type: step.action,
      reason: step.reason ?? null,
      by_user_id: step.actor?.userId ?? null,
      staff_account_id: step.actor?.staffAccountId ?? null,
      occurred_at: at,
      ...(step.press ? { client_uuid: step.press.clientUuid } : {}),
    });
    if (!error) return;
    if (step.press && error.code === UNIQUE_VIOLATION) throw new ClockRowCollided();
    throw new BadRequestException(error.message);
  }

  /**
   * Write what a clock row does to its bout. Checked: the row is saved by now,
   * and a lost update would leave the clock ended on a bout that still runs,
   * with every later send of that press answered "done".
   */
  private async writeBout(matchId: string, columns: Record<string, unknown>): Promise<void> {
    const { error } = await this.supabase.service.from('matches').update(columns).eq('id', matchId);
    if (error) throw new Error(`Clock row saved, bout ${matchId} not updated: ${error.message}`);
  }

  /** Write one clock row, and what it does to the bout. */
  private async record(
    matchId: string,
    match: Record<string, unknown>,
    current: ClockState,
    step: ClockStep,
  ): Promise<ClockState> {
    const { action, ending, uncompletes } = step;
    // The time of the row: now, or where a press sent late or the server's own is placed.
    const now = step.at ?? new Date().toISOString();
    await this.insertRow(matchId, step, now);

    // Ruling 331: out of `completed`, no result. An End read the old winner first.
    const noResult = uncompletes ? noResultColumns() : {};
    if (action === 'start' || action === 'resume') {
      const started = action === 'start' ? { started_at: now } : {};
      await this.writeBout(matchId, { status: 'running', ...started, ...noResult });
    } else if (action === 'halt') {
      await this.writeBout(matchId, { status: 'paused', ...noResult });
    } else if (action === 'end') {
      await this.completeOnEnd(matchId, match, current, ending, now);
    } else if (action === 'reopen') {
      // Reverses a prior 'end': clock goes back to halted with the
      // accumulated active time preserved (computeClockState reads the
      // same event-sourced timeline). Clears ended_at + locked_at so
      // scoring can resume.
      const reopenUpdates: Record<string, unknown> = {
        ...reopenedResultColumns(),
        locked_at: null,
        duration_total_ms: null,
      };
      // Best-of: pop the round that ended the series so it reopens for
      // correction. A series a forfeit ended keeps its closed rounds.
      const poppedRound = popClinchingRoundColumns(match);
      if (poppedRound) Object.assign(reopenUpdates, poppedRound);
      await this.writeBout(matchId, reopenUpdates);
    }

    this.logger.log(`Match ${matchId}: clock ${action}`);
    return this.getClockState(matchId);
  }

  /** What an End writes on the bout: completed at `now`, with its two durations and its result. */
  private async completeOnEnd(
    matchId: string,
    match: Record<string, unknown>,
    current: ClockState,
    ending: ClockStep['ending'],
    now: string,
  ): Promise<void> {
    let finalActiveMs = current.activeMs;
    if (current.status === 'running' && current.runningFrom) {
      finalActiveMs += new Date(now).getTime() - new Date(current.runningFrom).getTime();
    }
    const matchStartedAt = (match as { started_at?: string | null }).started_at;
    const durationTotalMs = matchStartedAt
      ? new Date(now).getTime() - new Date(matchStartedAt).getTime()
      : null;
    await this.writeBout(matchId, {
      status: 'completed',
      ended_at: now,
      duration_active_ms: finalActiveMs,
      ...(durationTotalMs !== null ? { duration_total_ms: durationTotalMs } : {}),
      ...(ending && 'complete' in ending ? ending.complete : {}),
    });
    // Ending the clock completes the match, so the bracket must advance here
    // too — this and the point-cap path in ScoringService are the only ways a
    // pad-scored match ever finishes. It can advance now: the update above
    // NAMES the leader, where it used to leave the winner null and strand
    // every time-limit bout in the bracket.
    await this.matchCompletion?.onMatchCompleted(matchId);
  }

  // ── Level at time ─────────────────────────────────────────────────────────

  /**
   * Take a LEVEL bout one step down its phase's chain of remedies, and apply it.
   *
   * The step is the referee's, not the engine's: `end` refuses a level bout and
   * NAMES the remedy, and this is where the operator says they have played it.
   * Recorded as a `level_resolution` row on the match timeline, so the position
   * replays like the clock does and a `reset_match` puts it back to the start.
   *
   * The insert's error is CHECKED, unlike the best-effort round events: here the
   * event IS the state. A swallowed failure would leave the chain where it was
   * and hand the referee the same remedy again, having already granted the time.
   *
   * REFUSED WHILE THE BOUT STILL HAS TIME, exactly as the End is. This is the
   * other door onto the chain, and a chain that can be walked down before the
   * clock runs out is advice rather than a rule.
   *
   * `extra_time` puts the seconds back on the clock and leaves it halted — the
   * referee restarts when the fighters are ready, in EITHER timer mode, because
   * the limit is what the bout ends on and `timerMode` only says how it is
   * shown. `sudden_death` does not touch the clock at all: there is no per-match
   * limit to lift, the countdown simply sits at 00:00, and the pad shows a skull
   * with a count-up instead of a numeral.
   */
  async advanceLevelResolution(
    matchId: string,
    actor?: { userId?: string; staffAccountId?: string; canOverrideLocked?: boolean },
  ): Promise<{ applied: LevelStep; clock: ClockState }> {
    const { data: match } = await this.supabase.service
      .from('matches')
      .select(
        'id, status, locked_at, red_registration_id, blue_registration_id, ' +
          'winner_registration_id, red_score, blue_score, match_number_label, ' +
          'awaiting_round_advance, phases(type, tournaments(ruleset_config))',
      )
      .eq('id', matchId)
      .maybeSingle();
    if (!match) throw new NotFoundException(`Match ${matchId} not found`);
    const row = match as unknown as Record<string, unknown>;
    if ((row['locked_at'] as string | null) && !actor?.canOverrideLocked) {
      throw matchLocked();
    }
    if (row['status'] === 'completed') throw new BadRequestException('Match is already completed');
    // Between rounds of a best-of match the scores on the row are the CLOSED
    // round's, frozen and often level. A remedy played against them would
    // burn a chain step on a round that is already over.
    if (row['awaiting_round_advance']) {
      throw new BadRequestException('Round already ended — advance to the next round');
    }
    if (!isLevelBout(row)) {
      throw new BadRequestException('Scores are not level — end the bout on the clock');
    }

    const before = await this.getClockState(matchId);
    const { matchFormat, phaseType, matchNumberLabel } = matchFormatContext(row);
    // The same guard the End carries, on the other door. Without it a referee
    // could collect extra time at 2-2 with thirty seconds still to fight, and
    // the chain would be spent before the bout was.
    if (!timeIsFinished(before.totalActiveMs, matchFormat, phaseType, matchNumberLabel)) {
      throw endRefusal({ reason: 'time_not_finished' });
    }
    const step = pendingLevelStep(
      matchFormat,
      phaseType,
      matchNumberLabel,
      before.levelResolutionSteps,
    );
    if (step === null || step.kind === 'draw') {
      throw new BadRequestException('No further remedy for a level bout in this phase');
    }

    const sequence = await this.nextSequence(matchId);
    const { error: insertErr } = await this.supabase.service.from('match_events').insert({
      match_id: matchId,
      sequence,
      type: 'level_resolution',
      reason: step.kind === 'extra_time' ? `extra time ${step.seconds}s` : 'sudden death',
      by_user_id: actor?.userId ?? null,
      staff_account_id: actor?.staffAccountId ?? null,
      occurred_at: new Date().toISOString(),
    });
    if (insertErr) throw new BadRequestException(insertErr.message);

    if (step.kind === 'extra_time') {
      const limitSeconds = effectiveTimeLimitSeconds(matchFormat, phaseType, matchNumberLabel);
      const adjustment = extraTimeAdjustmentMs(
        step.seconds,
        before.totalActiveMs,
        limitSeconds !== null ? limitSeconds * 1000 : null,
      );
      if (adjustment !== 0) {
        await this.adjustTime(matchId, adjustment, `extra time ${step.seconds}s`, {
          ...actor,
          canOverrideLocked: true,
        });
      }
    }

    this.logger.log(`Match ${matchId}: level resolution → ${step.kind}`);
    return { applied: step, clock: await this.getClockState(matchId) };
  }

  async adjustTime(
    matchId: string,
    adjustmentMs: number,
    reason?: string,
    actor?: { userId?: string; staffAccountId?: string; canOverrideLocked?: boolean },
  ): Promise<ClockState> {
    const { data: match } = await this.supabase.service
      .from('matches')
      .select('id, locked_at')
      .eq('id', matchId)
      .maybeSingle();
    if (!match) throw new NotFoundException(`Match ${matchId} not found`);
    if ((match as { locked_at?: string | null }).locked_at && !actor?.canOverrideLocked) {
      throw matchLocked();
    }
    const sequence = await this.nextSequence(matchId);
    // Same silent-no-op guard as clockAction: a failed insert must surface
    // as an error, not as an unchanged clock with HTTP 200.
    const { error: insertErr } = await this.supabase.service.from('match_events').insert({
      match_id: matchId,
      sequence,
      type: 'adjust_time',
      reason: reason ?? null,
      adjustment_ms: adjustmentMs,
      by_user_id: actor?.userId ?? null,
      staff_account_id: actor?.staffAccountId ?? null,
      occurred_at: new Date().toISOString(),
    });
    if (insertErr) throw new BadRequestException(insertErr.message);
    return this.getClockState(matchId);
  }

  // ── Compute clock state from events ──────────────────────────────────────

  computeClockState(
    matchId: string,
    rawEvents: Array<{
      id: string;
      type: string;
      reason: string | null;
      occurred_at: string;
      adjustment_ms?: number | null;
    }>,
  ): ClockState {
    // Split the level-at-time steps out before replaying. They share the
    // timeline and the query, and they must not reach the clock: `ClockAction`
    // stays the six transitions plus the two adjustments, and the pad's unified
    // timeline keeps showing only what moved the clock. Counting them here
    // rather than in their own read is also what keeps the ordered six-read
    // queue in `clock-end-result.test.ts` intact.
    const clockRows: typeof rawEvents = [];
    let levelResolutionSteps = 0;
    for (const e of rawEvents) {
      if (e.type === 'level_resolution') {
        levelResolutionSteps += 1;
        continue;
      }
      // Starting the next round of a best-of match puts the chain back to the
      // top: each round is its OWN bout, so it plays its own extra time and its
      // own sudden death. Dropped from `clockRows` rather than merely counted,
      // because `ClockAction` does not carry it and the pad's unified timeline
      // shows only what moved the clock — the clock is reset separately.
      if (e.type === 'round_advance') {
        levelResolutionSteps = 0;
        continue;
      }
      // A reset puts the bout back to unplayed, so the chain starts over too —
      // the same semantics the clock gets from replaying its own timeline.
      if (e.type === 'reset_match') levelResolutionSteps = 0;
      clockRows.push(e);
    }

    const events = clockRows.map((e) => ({
      id: e.id,
      type: e.type as ClockAction,
      occurredAt: e.occurred_at,
      reason: e.reason,
      adjustmentMs: e.adjustment_ms ?? null,
    }));

    // The fold is the shared one: the pad replays the presses it still holds
    // by the same rules.
    const { status, activeMs, runningFrom, startedAt } = foldClock(events);

    // Compute total including current running interval
    const totalActiveMs =
      status === 'running' && runningFrom
        ? activeMs + (Date.now() - new Date(runningFrom).getTime())
        : activeMs;

    return {
      matchId,
      status,
      activeMs,
      runningFrom,
      totalActiveMs,
      startedAt,
      levelResolutionSteps,
      events,
    };
  }

  private async nextSequence(matchId: string): Promise<number> {
    const { data: lastEvent } = await this.supabase.service
      .from('match_events')
      .select('sequence')
      .eq('match_id', matchId)
      .order('sequence', { ascending: false })
      .limit(1)
      .maybeSingle();

    return ((lastEvent as { sequence: number } | null)?.sequence ?? 0) + 1;
  }
}
