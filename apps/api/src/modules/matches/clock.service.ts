/**
 * apps/api/src/modules/matches/clock.service.ts
 *
 * Match clock service — persists clock state as match_events rows.
 * Clock state is always recomputed from the match_events timeline,
 * never stored as a separate field. This makes it lossless and replayable.
 * One row is ever taken back: a press whose bout was completed between its
 * read and its write (`writeBoutInPlay`).
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
  backInPlayColumns,
  noResultColumns,
  popClinchingRoundColumns,
  reopenedResultColumns,
} from './reopen-match-columns';
import { timeLimitResult } from './time-limit-result';
import { takeLevelStep, type LateLevelPress } from './level-step';
import { endRefusal } from './level-at-time-refusal';
import { isOver } from '../../common/live-status';
import { eventResultsFrozen } from './event-results-frozen';
import {
  againOnCollision,
  alreadyTrue,
  boutCompleted,
  ClockRowCollided,
  elapsedAt,
  eventStatusOf,
  judgedSequence,
  lastTimelineRow,
  placeLatePress,
  savedPressSpeaksForBout,
  placedInTimeline,
  pressIsSaved,
  type LatePress,
  type PressAction,
} from './late-press';
import { matchLocked } from './match-locked';
import { pressedBeforeReopen } from './press-before-reopen';
import { resetAfterLevelStep } from './reset-after-level-step';
import { roundAwaitsAdvance } from './round-awaits-advance';
import type { LevelStep } from '@myclash/rulesets';
import { CLOCK_ACTIONS_FROM, foldClock } from '@myclash/rules';

/**
 * Asked by an End once every refusal of its door has passed: did the sheet end the bout? True
 * when it did, and the End then writes nothing (`ScoringService.sheetEndedLevelBout`). Given by
 * the clock's HTTP doors only; the server's own Ends (a cap, a forfeit) decide on their own.
 * Asked HERE and not before the door: a queued End made before a Reopen, on an Event that is
 * over, or on a locked bout must meet its refusal first.
 */
export type SheetEnds = (matchId: string, at?: string) => Promise<boolean>;

export type ClockAction =
  | 'start'
  | 'halt'
  | 'resume'
  | 'end'
  | 'reopen'
  | 'reset_clock'
  | 'adjust_time'
  | 'reset_match'
  | 'level_resolution';

/** Who takes a step of a level bout, and whether they pass the lock. */
interface LevelActor {
  userId?: string;
  staffAccountId?: string;
  canOverrideLocked?: boolean;
}

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
   * and the rows are in the same timeline, so it costs no extra query. A step
   * is in `events` too: a step of extra time carries the correction of the
   * clock that gives the time, and a reader that folds `events` by itself (the
   * chart of a bout) must see it.
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
  /** The sequence a press sent late took with its placement (`placedInTimeline`). None: next. */
  sequence?: number;
}

// The scores and the phase's match format are here so `end` can NAME
// the winner of a bout that ran out of time — see `timeLimitResult`.
// `status` is there because a bout already completed is not decided
// again, and `winner_registration_id` because the decision reads the
// LADDER, not the scores. The Event's status is for a press sent late.
const BOUT_COLUMNS =
  'id, status, locked_at, started_at, rounds_json, current_round, ' +
  'red_registration_id, blue_registration_id, winner_registration_id, ' +
  'red_score, blue_score, match_number_label, awaiting_round_advance, back_in_play_at, ' +
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
      // `level_resolution` is how far down the phase's level-at-time chain the
      // bout has been taken: `computeClockState` counts it, and folds the time
      // a step of extra time gives. One query rather than two, on the read the
      // pad makes after every action.
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
    sheetEnds?: SheetEnds,
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
    // Once a level step is taken, a Reset would put regulation time back under a chain already
    // at its next step ("Reset + chain", 2026-10-16). "Start round N+1" resets after its own row,
    // which puts the chain back to the top first.
    if (action === 'reset_clock' && current.levelResolutionSteps > 0) {
      throw resetAfterLevelStep();
    }
    // Every refusal of this door has passed: an End may ask the sheet first (`SheetEnds`).
    if (action === 'end' && sheetEnds && (await sheetEnds(matchId))) {
      return this.getClockState(matchId);
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
    sheetEnds?: SheetEnds,
  ): Promise<ClockState> {
    return againOnCollision(() => this.takePress(matchId, action, press, actor, sheetEnds));
  }

  private async takePress(
    matchId: string,
    action: PressAction,
    press: LatePress,
    actor?: ClockActor,
    sheetEnds?: SheetEnds,
  ): Promise<ClockState> {
    const db = this.supabase.service;
    if (await pressIsSaved(db, press.clientUuid))
      return this.finishSavedPress(matchId, action, press);
    // Before the reads that judge the press (S11): a row written meanwhile collides with it.
    const sequence = await judgedSequence(db, matchId);
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
    // Every refusal of a late press has passed (`placeLatePress`): an End may ask the sheet first.
    if (action === 'end' && sheetEnds && (await sheetEnds(matchId, at))) {
      return this.getClockState(matchId);
    }
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
      sequence,
    });
  }

  /**
   * A press sent again whose clock row is saved: the server finishes the bout write it missed.
   *
   * The row is written first and the bout after it. When the second write failed, the tablet got
   * an error and sent the press again, and the server answered it from the clock alone: an End
   * left the bout "running" under an ended clock, with no winner and no bracket move, for good; a
   * Start left it "scheduled", and every hit was held as a hit of a bout not started.
   *
   * Only while nothing since speaks for the bout: the press is the row the timeline ends with (a
   * forfeit's own End or a Reopen after it makes it history), no door put the bout back in play
   * after it (a correction, which writes no clock row, sets `back_in_play_at`), the bout is not
   * voided and its Event is not over. Any of those, and the bout is left as it reads. Never a row
   * taken back here: the saved row may be an old one, and the clock would lose it.
   */
  private async finishSavedPress(
    matchId: string,
    action: PressAction,
    press: LatePress,
  ): Promise<ClockState> {
    const db = this.supabase.service;
    const current = await this.getClockState(matchId);
    const last = await lastTimelineRow(db, matchId);
    if (!last || last.client_uuid !== press.clientUuid) return current;
    const { data } = await db.from('matches').select(BOUT_COLUMNS).eq('id', matchId).maybeSingle();
    const match = data as unknown as Record<string, unknown> | null;
    if (!match || !savedPressSpeaksForBout(match, last.occurred_at)) return current;
    const at = last.occurred_at;
    if (action === 'end') {
      if (match['status'] === 'completed') return current;
      const ending = timeLimitResult(match, current.levelResolutionSteps, elapsedAt(current, at));
      if ('refuse' in ending) return current;
      const lost = await this.completeOnEnd(matchId, match, current, ending, at);
      // The row stays (see above); the bout is left as the write that won it.
      if (lost) this.logger.warn(`Match ${matchId}: saved End not finished: ${lost.message}`);
    } else {
      const status = action === 'halt' ? 'paused' : 'running';
      if (match['status'] === status) return current;
      const started = action === 'start' ? { started_at: at } : {};
      await this.writeIfNotCompleted(matchId, { status, ...started });
    }
    return this.getClockState(matchId);
  }

  /**
   * Insert the clock row at the bout's next sequence.
   *
   * The error MUST be checked: an unchecked failed insert would return a
   * recomputed-but-unchanged clock with HTTP 200 — a silent no-op the operator
   * can't diagnose. A press sent late that loses its sequence, or its own id,
   * to another writer says so with `ClockRowCollided`: `latePress` asks again.
   */
  private async insertRow(matchId: string, step: ClockStep, at: string): Promise<number> {
    const sequence = step.sequence ?? (await this.nextSequence(matchId));
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
    if (!error) return sequence;
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

  /** Write the bout only while it is not completed; false when the completion won. */
  private async writeIfNotCompleted(
    matchId: string,
    columns: Record<string, unknown>,
  ): Promise<boolean> {
    const { data, error } = await this.supabase.service
      .from('matches')
      .update(columns)
      .eq('id', matchId)
      .neq('status', 'completed')
      .select('id')
      .maybeSingle();
    if (error) throw new Error(`Clock row saved, bout ${matchId} not updated: ${error.message}`);
    return data !== null;
  }

  /**
   * Put a bout in play (Start, Halt, Resume, or a Reopen that un-completes nothing) only while it
   * is not completed (`writeIfNotCompleted`). The race, named: the bout's status was read before the clock row, and a
   * closing hit, a forfeit, an End from another tablet or a PATCH can complete it in between.
   * Unguarded, the write left it running with its winner kept and its bracket already moved on.
   * The refusal is in the write itself, as `MatchesService.updateStatus` does (ruling 338). When
   * the completion won, the clock row just written is taken back, so a resend is judged afresh,
   * and the press meets the refusal a press sent late on a completed bout already meets.
   * A narrower window stays, named: a resend landing between the insert and the take-back is
   * answered "saved" by `pressIsSaved`. It heals: the take-back is a `match_events` change, which
   * the live views read again, and the bout is completed either way.
   */
  private async writeBoutInPlay(
    matchId: string,
    sequence: number,
    columns: Record<string, unknown>,
  ): Promise<void> {
    if (await this.writeIfNotCompleted(matchId, columns)) return;
    await this.takeBackRow(matchId, sequence, boutCompleted());
  }

  /** Take back the clock row a bout write lost, so a resend is judged afresh, then refuse. */
  private async takeBackRow(matchId: string, sequence: number, refusal: Error): Promise<never> {
    const { error: takeBack } = await this.supabase.service
      .from('match_events')
      .delete()
      .eq('match_id', matchId)
      .eq('sequence', sequence);
    if (takeBack) {
      throw new Error(`Bout ${matchId} changed meanwhile, clock row kept: ${takeBack.message}`);
    }
    throw refusal;
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
    const sequence = await this.insertRow(matchId, step, now);
    // Ruling 331 takes a bout out of `completed` on purpose; any other press puts in play only
    // a bout that is not completed when it is written.
    const inPlay = (columns: Record<string, unknown>) =>
      uncompletes
        ? this.writeBout(matchId, columns)
        : this.writeBoutInPlay(matchId, sequence, columns);

    // Ruling 331: out of `completed`, no result. An End read the old winner first.
    // And the mark of a bout put back in play, in the same write.
    // A series also gets back the round whose close ended it, as a Reopen does: kept closed, no
    // hit could close it again, and a later End completed the bout with no winner.
    const noResult = uncompletes
      ? {
          ...noResultColumns(),
          ...popClinchingRoundColumns(match),
          ...backInPlayColumns(now, match['back_in_play_at']),
        }
      : {};
    if (action === 'start' || action === 'resume') {
      const started = action === 'start' ? { started_at: now } : {};
      await inPlay({ status: 'running', ...started, ...noResult });
    } else if (action === 'halt') {
      await inPlay({ status: 'paused', ...noResult });
    } else if (action === 'end') {
      // Completed or put back in play since its read: not this End's bout any more.
      const lost = await this.completeOnEnd(matchId, match, current, ending, now);
      if (lost) await this.takeBackRow(matchId, sequence, lost);
    } else if (action === 'reopen') {
      await inPlay(reopenColumns(match, uncompletes, now));
    }

    this.logger.log(`Match ${matchId}: clock ${action}`);
    return this.getClockState(matchId);
  }

  /**
   * Complete the bout an End ended: completed at `now`, with its two durations and its result.
   * Null when written; the refusal when another write won the bout since `match` was read.
   *
   * The races, named. A desk's Reopen, or the undo of the hit that ended the bout, lands between
   * the End's read and this write (S4b): unguarded, the End completed the bout the desk had just
   * opened. Or a closing hit, a forfeit or another tablet's End completes it there: unguarded,
   * the End wrote its own winner over the one that won, and completed the bout twice. The write
   * asks for the mark the door read (`back_in_play_at`, which never moves back) and, of a bout
   * the door read not completed, a bout that is still not completed.
   */
  private async completeOnEnd(
    matchId: string,
    match: Record<string, unknown>,
    current: ClockState,
    ending: ClockStep['ending'],
    now: string,
  ): Promise<Error | null> {
    let finalActiveMs = current.activeMs;
    if (current.status === 'running' && current.runningFrom) {
      finalActiveMs += new Date(now).getTime() - new Date(current.runningFrom).getTime();
    }
    const matchStartedAt = (match as { started_at?: string | null }).started_at;
    const durationTotalMs = matchStartedAt
      ? new Date(now).getTime() - new Date(matchStartedAt).getTime()
      : null;
    const write = this.supabase.service
      .from('matches')
      .update({
        status: 'completed',
        ended_at: now,
        duration_active_ms: finalActiveMs,
        ...(durationTotalMs !== null ? { duration_total_ms: durationTotalMs } : {}),
        ...(ending && 'complete' in ending ? ending.complete : {}),
      })
      .eq('id', matchId);
    // A bout read completed keeps its result (`timeLimitResult`): its End only ends the clock.
    const notWon = match['status'] === 'completed' ? write : write.neq('status', 'completed');
    const mark = match['back_in_play_at'];
    const { data, error } = await (
      typeof mark === 'string'
        ? notWon.eq('back_in_play_at', mark)
        : notWon.is('back_in_play_at', null)
    )
      .select('id')
      .maybeSingle();
    if (error) throw new Error(`Clock row saved, bout ${matchId} not updated: ${error.message}`);
    if (!data) return this.endLostTo(matchId);
    // Ending the clock completes the match, so the bracket must advance here
    // too — this and the point-cap path in ScoringService are the only ways a
    // pad-scored match ever finishes. It can advance now: the update above
    // NAMES the leader, where it used to leave the winner null and strand
    // every time-limit bout in the bracket.
    await this.matchCompletion?.onMatchCompleted(matchId);
    return null;
  }

  /**
   * The refusal of an End whose bout write lost: `bout_completed` when a completion won it, the
   * one of a press from before a put-back in play otherwise. Both tell the pad the bout moved on.
   */
  private async endLostTo(matchId: string): Promise<Error> {
    const { data, error } = await this.supabase.service
      .from('matches')
      .select('status')
      .eq('id', matchId)
      .maybeSingle();
    if (error) this.logger.warn(`Match ${matchId}: End lost, bout not read: ${error.message}`);
    const status = (data as { status?: unknown } | null)?.status;
    return status === 'completed' ? boutCompleted() : pressedBeforeReopen();
  }

  // ── Level at time ─────────────────────────────────────────────────────────

  /**
   * Take a LEVEL bout one step down its phase's chain of remedies: extra time,
   * then sudden death. `level-step.ts` owns the step, for a press of now and
   * for one a pad sends late (`late`), which is answered with the clock alone,
   * as a clock press sent late is.
   */
  advanceLevelResolution(
    matchId: string,
    actor?: LevelActor,
  ): Promise<{ applied: LevelStep; clock: ClockState }>;
  advanceLevelResolution(
    matchId: string,
    actor: LevelActor | undefined,
    late: LateLevelPress,
  ): Promise<ClockState>;
  advanceLevelResolution(
    matchId: string,
    actor?: LevelActor,
    late?: LateLevelPress,
  ): Promise<{ applied: LevelStep; clock: ClockState } | ClockState> {
    const deps = { db: this.supabase.service, clock: this };
    return late ? takeLevelStep(deps, matchId, actor, late) : takeLevelStep(deps, matchId, actor);
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
    // Count the level-at-time steps while replaying. They share the timeline
    // and the query, and a step stays in the clock's rows: the one of extra
    // time carries the correction that gives the time (`level-step.ts`).
    // Counting them here rather than in their own read is also what keeps the
    // ordered six-read queue in `clock-end-result.test.ts` intact.
    const clockRows: typeof rawEvents = [];
    let levelResolutionSteps = 0;
    for (const e of rawEvents) {
      if (e.type === 'level_resolution') levelResolutionSteps += 1;
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

/**
 * What a Reopen writes on its bout. It reverses a prior 'end': the clock goes back to halted with
 * the accumulated active time preserved (computeClockState reads the same event-sourced
 * timeline), and ended_at + locked_at are cleared so scoring can resume.
 */
function reopenColumns(
  match: Record<string, unknown>,
  uncompletes: boolean,
  now: string,
): Record<string, unknown> {
  const columns: Record<string, unknown> = {
    ...reopenedResultColumns(),
    locked_at: null,
    duration_total_ms: null,
  };
  // Best-of: pop the round that ended the series so it reopens for
  // correction. A series a forfeit ended keeps its closed rounds.
  const poppedRound = popClinchingRoundColumns(match);
  if (poppedRound) Object.assign(columns, poppedRound);
  // A Reopen on a bout that is not completed moves the clock alone, and
  // leaves no mark: the Reopen "Start round N+1" makes itself
  // (`round-advance.ts`), and the one a forfeit taken back makes on the clock
  // the forfeit ended (`MatchForfeitsService.reopenClockTakenBack`).
  if (uncompletes) Object.assign(columns, backInPlayColumns(now, match['back_in_play_at']));
  return columns;
}
