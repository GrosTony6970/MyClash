import { BadRequestException, NotFoundException } from '@nestjs/common';
import { extraTimeAdjustmentMs } from '@myclash/rules';
import {
  effectiveTimeLimitSeconds,
  pendingLevelStep,
  timeIsFinished,
  type LevelStep,
} from '@myclash/rulesets';
import { isOver } from '../../common/live-status';
import type { SupabaseService } from '../supabase/supabase.service';
import type { ClockService, ClockState } from './clock.service';
import { eventResultsFrozen } from './event-results-frozen';
import { assertScoredAfterLastReset } from './hit-before-reset';
import {
  againOnCollision,
  boutCompleted,
  elapsedAt,
  eventStatusOf,
  judgedSequence,
  OLDEST_PRESS_MS,
  placedInTimeline,
  pressedAtServer,
  pressTooOld,
} from './late-press';
import { endRefusal } from './level-at-time-refusal';
import { matchLocked } from './match-locked';
import { assertPressedAfterBackInPlay } from './press-before-reopen';
import type { LateRoundPress } from './round-advance';
import { savedRoundPress, writeRoundRow } from './round-rows';
import { ROUND_AWAITS_ADVANCE } from './round-awaits-advance';
import { roundNotOpen } from './round-end';
import { isLevelBout, matchFormatContext } from './time-limit-result';

type Database = SupabaseService['service'];

/**
 * A step of a LEVEL bout down its phase's chain of remedies: extra time, then
 * sudden death. The one owner of the step, for a press of now and for one a
 * pad made with no network and sends later (operator ruling 13).
 *
 * The step is the referee's, not the engine's: an End refuses a level bout at
 * its time and NAMES the remedy, and this is where the official says they play
 * it. It is ONE row of the bout's timeline, `level_resolution`. The position in
 * the chain is the count of those rows (`computeClockState`), and the row of a
 * step of extra time carries the correction of the clock that gives the time
 * (`adjustment_ms`), so a step is never counted without its time.
 *
 * A clock that runs is paused first, at the time of the step (operator,
 * 2026-10-12): the official taps Resume when the fighters are ready. Before,
 * the clock kept running, and the time given back came off the part of the
 * clock that was closed: after one long run the extra time was lost at once.
 *
 * THE ORDER OF THE WRITES IS THE GUARANTEE, because there is no transaction:
 * the Halt, then the bout's status, then the step with its id. A send cut short
 * before the step's own row is new to the server at its next send: every rule
 * is asked again, on a clock that is already paused.
 */
export interface LateLevelPress extends LateRoundPress {
  /** The steps the round had taken before this one: 0 for the first. */
  step: number;
}

interface Actor {
  userId?: string;
  staffAccountId?: string;
  canOverrideLocked?: boolean;
}

export interface LevelDeps {
  db: Database;
  clock: Pick<ClockService, 'getClockState'>;
}

/** The Event's status and the two marks are for a step sent late. */
const BOUT_COLUMNS =
  'id, status, locked_at, current_round, red_registration_id, blue_registration_id, ' +
  'winner_registration_id, red_score, blue_score, match_number_label, ' +
  'awaiting_round_advance, back_in_play_at, ' +
  'phases(type, tournaments(ruleset_config, events(status)))';

/** The codes of the two refusals below. The pad holds the step and says them. */
export const BOUT_NOT_LEVEL = 'bout_not_level';
export const LEVEL_STEP_NOT_PENDING = 'level_step_not_pending';

/** A fighter leads, or the bout has its winner: there is nothing to play out. */
const boutNotLevel = () =>
  new BadRequestException({
    message: 'Scores are not level — end the bout on the clock',
    code: BOUT_NOT_LEVEL,
  });

/**
 * The chain has no step to take here: it is spent, it ends in a draw, or the
 * pad counted the steps another way than the server.
 */
const levelStepNotPending = (message: string) =>
  new BadRequestException({ message, code: LEVEL_STEP_NOT_PENDING });

/**
 * Between two rounds of a best-of bout the scores on the row are the CLOSED
 * round's, frozen and often level. A remedy played against them would burn a
 * step of the chain on a round that is over.
 */
const roundAlreadyEnded = () =>
  new BadRequestException({
    message: 'Round already ended — advance to the next round',
    code: ROUND_AWAITS_ADVANCE,
  });

/**
 * The late step a body names, or null for the body of the pad of before. All
 * five fields or none, for the reason `latePressOf` gives.
 */
export function lateLevelPressOf(body: {
  clientUuid?: string;
  round?: number;
  step?: number;
  pressedAt?: string;
  sentAt?: string;
}): LateLevelPress | null {
  const { clientUuid, round, step, pressedAt, sentAt } = body;
  if ([clientUuid, round, step, pressedAt, sentAt].every((field) => field === undefined)) {
    return null;
  }
  if (!clientUuid || !round || step === undefined || !pressedAt || !sentAt) {
    throw new BadRequestException(
      'A level step with an id names its id, its round, its place in the chain, ' +
        'the time of the press and the time of the send',
    );
  }
  return { clientUuid, round, step, pressedAt, sentAt };
}

async function readBout(db: Database, matchId: string): Promise<Record<string, unknown>> {
  const { data } = await db.from('matches').select(BOUT_COLUMNS).eq('id', matchId).maybeSingle();
  if (!data) throw new NotFoundException(`Match ${matchId} not found`);
  return data as unknown as Record<string, unknown>;
}

/**
 * The step the bout waits for, judged on the time its clock had run. The time
 * is asked as the End asks it: a chain that can be walked down before the
 * clock runs out is advice, not a rule.
 */
function pendingStep(
  bout: Record<string, unknown>,
  stepsTaken: number,
  elapsedMs: number,
): LevelStep {
  if (bout['awaiting_round_advance']) throw roundAlreadyEnded();
  if (!isLevelBout(bout)) throw boutNotLevel();
  const { matchFormat, phaseType, matchNumberLabel } = matchFormatContext(bout);
  if (!timeIsFinished(elapsedMs, matchFormat, phaseType, matchNumberLabel)) {
    throw endRefusal({ reason: 'time_not_finished' });
  }
  const step = pendingLevelStep(matchFormat, phaseType, matchNumberLabel, stepsTaken);
  if (step === null || step.kind === 'draw') {
    throw levelStepNotPending('No further remedy for a level bout in this phase');
  }
  return step;
}

/** The correction of the clock a step carries: none for sudden death. */
function timeGiven(bout: Record<string, unknown>, step: LevelStep, elapsedMs: number) {
  if (step.kind !== 'extra_time') return {};
  const { matchFormat, phaseType, matchNumberLabel } = matchFormatContext(bout);
  const limitSeconds = effectiveTimeLimitSeconds(matchFormat, phaseType, matchNumberLabel);
  const limitMs = limitSeconds !== null ? limitSeconds * 1000 : null;
  const adjustmentMs = extraTimeAdjustmentMs(step.seconds, elapsedMs, limitMs);
  // No limit: there is nothing to extend, and the row says no correction.
  return adjustmentMs === 0 ? {} : { adjustmentMs };
}

/** What every step is written from: the bout, its clock, and where the step goes. */
interface Placed {
  bout: Record<string, unknown>;
  clock: ClockState;
  /** The time of the step's rows. */
  at: string;
  /** Of a step sent late: its id. */
  clientUuid?: string;
  /** Of a step sent late: the sequence of its first row (`judgedSequence`). */
  sequence?: number;
}

/**
 * Judge the step and write it: the Halt of a clock that runs, the bout's
 * status, then the step. A bout whose row says "running" is put to "paused"
 * also when its clock is halted already: that is a send cut short after the
 * Halt, finished here.
 */
async function writeStep(
  db: Database,
  matchId: string,
  actor: Actor | undefined,
  placed: Placed,
): Promise<LevelStep> {
  const { bout, clock, at, clientUuid } = placed;
  const elapsedMs = elapsedAt(clock, at);
  const step = pendingStep(bout, clock.levelResolutionSteps, elapsedMs);

  // A late step's rows take the sequences that follow its placement; a step of now, the next.
  let sequence = placed.sequence;
  if (clock.status === 'running') {
    const halt = { type: 'halt', reason: 'level step' } as const;
    await writeRoundRow(db, matchId, halt, actor, { at, sequence });
    if (sequence !== undefined) sequence += 1;
  }
  if (bout['status'] === 'running') {
    const { error } = await db.from('matches').update({ status: 'paused' }).eq('id', matchId);
    if (error) throw new Error(`Clock halted, bout ${matchId} not updated: ${error.message}`);
  }
  const reason = step.kind === 'extra_time' ? `extra time ${step.seconds}s` : 'sudden death';
  const written = {
    type: 'level_resolution',
    reason,
    ...timeGiven(bout, step, elapsedMs),
  } as const;
  await writeRoundRow(db, matchId, written, actor, { at, clientUuid, sequence });
  return step;
}

/** The pad of before: the next step, now. Its refusals keep their words. */
async function stepNow(
  deps: LevelDeps,
  matchId: string,
  actor: Actor | undefined,
): Promise<{ applied: LevelStep; clock: ClockState }> {
  const bout = await readBout(deps.db, matchId);
  if (bout['locked_at'] && !actor?.canOverrideLocked) throw matchLocked();
  if (bout['status'] === 'completed') throw new BadRequestException('Match is already completed');
  const clock = await deps.clock.getClockState(matchId);
  const at = new Date().toISOString();
  const applied = await writeStep(deps.db, matchId, actor, { bout, clock, at });
  return { applied, clock: await deps.clock.getClockState(matchId) };
}

/**
 * Take a step a pad sends late. The order of the rules is the one of a late
 * "End round" (`round-end.ts`), and for the same reasons:
 *
 *   1. A step the server holds is answered with the clock. No rule below may
 *      answer it: the pad reads a refusal as "never taken".
 *   2. A new one: an over Event refuses it, to everybody. A completed bout
 *      takes none, a press older than one day is not applied, and one from
 *      before the bout's last reset, or from before the bout was last put back
 *      in play, is for the bout as it was. Then the lock.
 *   3. The bout must be in the round the step was tapped in.
 *   4. A round that took this step already is done, and nothing is written
 *      (ruling 12: another tablet took it). A round that has taken FEWER steps
 *      than the pad counted is refused: the pad counted another way.
 *   5. The rules of every step, with the time judged as it was WHEN PRESSED.
 */
async function stepLate(
  deps: LevelDeps,
  matchId: string,
  actor: Actor | undefined,
  late: LateLevelPress,
): Promise<ClockState> {
  const { db } = deps;
  const asked = { clientUuid: late.clientUuid, matchId, type: 'level_resolution' } as const;
  if (await savedRoundPress(db, asked)) return deps.clock.getClockState(matchId);
  // Before the reads that judge the step (S11): a row written meanwhile collides with it.
  const sequence = await judgedSequence(db, matchId);
  const bout = await readBout(db, matchId);
  if (isOver(eventStatusOf(bout))) throw eventResultsFrozen();
  if (bout['status'] === 'completed') throw boutCompleted();

  const nowMs = Date.now();
  const pressedMs = pressedAtServer(late, nowMs);
  if (nowMs - pressedMs > OLDEST_PRESS_MS) throw pressTooOld();
  await assertScoredAfterLastReset(db, matchId, new Date(pressedMs).toISOString());
  assertPressedAfterBackInPlay(matchId, bout['back_in_play_at'], pressedMs);
  if (bout['locked_at'] && !actor?.canOverrideLocked) throw matchLocked();
  if (((bout['current_round'] as number | null) ?? 1) !== late.round) {
    throw roundNotOpen(late.round);
  }

  const clock = await deps.clock.getClockState(matchId);
  if (clock.levelResolutionSteps > late.step) return clock;
  if (clock.levelResolutionSteps < late.step) {
    throw levelStepNotPending(`The round has not taken ${late.step} steps of its level chain`);
  }
  const at = await placedInTimeline(db, matchId, pressedMs);
  await writeStep(db, matchId, actor, { bout, clock, at, clientUuid: late.clientUuid, sequence });
  return deps.clock.getClockState(matchId);
}

/**
 * Take a level bout one step down its chain.
 *
 * Two writers on one bout: another tablet, or the server's own Halt, can write
 * a row between a step's rules and its insert. The insert then fails on a
 * unique key, and EVERY rule is asked again: the row that won may be this very
 * step, taken by the other tablet. After three tries the pad sends it again.
 */
export function takeLevelStep(
  deps: LevelDeps,
  matchId: string,
  actor?: Actor,
): Promise<{ applied: LevelStep; clock: ClockState }>;
export function takeLevelStep(
  deps: LevelDeps,
  matchId: string,
  actor: Actor | undefined,
  late: LateLevelPress,
): Promise<ClockState>;
export function takeLevelStep(
  deps: LevelDeps,
  matchId: string,
  actor?: Actor,
  late?: LateLevelPress,
): Promise<{ applied: LevelStep; clock: ClockState } | ClockState> {
  // A press of now is not tried again here: with no id, the row that won the
  // sequence could be this very step from another device, and a second try
  // would take the NEXT step with nobody asked. The caller is told to send again.
  if (!late) return stepNow(deps, matchId, actor);
  return againOnCollision(() => stepLate(deps, matchId, actor, late));
}
