import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { isOver } from '../../common/live-status';
import type { SupabaseService } from '../supabase/supabase.service';
import type { ClockService } from './clock.service';
import { eventResultsFrozen } from './event-results-frozen';
import { assertScoredAfterLastReset } from './hit-before-reset';
import {
  againOnCollision,
  BOUT_COMPLETED,
  boutCompleted,
  eventStatusOf,
  OLDEST_PRESS_MS,
  placedInTimeline,
  pressedAtServer,
  pressTooOld,
  type LatePress,
} from './late-press';
import { assertPressedAfterBackInPlay } from './press-before-reopen';
import { savedRoundPress, writeRoundRow } from './round-rows';
import { nextSequence, takeBackRow } from './timeline-sequence';
import { nothingOnTheSheet } from './start-count';

type Database = SupabaseService['service'];

/**
 * "Start round N+1" of a best-of bout: the one owner of the advance.
 *
 * A pad with no network closes a round itself and the official taps "Start
 * round 2" (operator, 2026-10-10). The pad keeps that tap in its queue with an
 * id, the round it opens and its own two times, and sends it later: the server
 * opens the round once, at the time of the tap, so the clock presses of the new
 * round behind it keep their own times. A body with no id is the pad of
 * before: the round opens now.
 *
 * THE ORDER OF THE WRITES IS THE GUARANTEE, because there is no transaction:
 * the `round_advance` row, then the clock at zero, then the bout. While the
 * bout row has not moved the round still waits, so no hit, no card and no clock
 * Start is taken: a second send finds what the first one left, and finishes it.
 */
export interface LateRoundPress extends LatePress {
  /** The round this press opens: 2 or more. */
  round: number;
}

interface Actor {
  userId?: string;
  staffAccountId?: string;
}

export interface AdvanceDeps {
  db: Database;
  clock: Pick<ClockService, 'getClockState' | 'clockAction'>;
  /** Reads the sheet of the round that is now open. */
  recompute: (matchId: string) => Promise<unknown>;
}

/** The Event's status is for an advance sent late: an over Event takes no new one. */
const BOUT_COLUMNS =
  'id, status, awaiting_round_advance, current_round, back_in_play_at, ' +
  'phases(tournaments(events(status)))';

export const ROUND_NOT_WAITING = 'round_not_waiting';

/**
 * The server does not see the round before this one as closed, or waits for
 * another round: the pad counted the bout another way. The pad holds the
 * press with the rows of its bout behind it, and shows the server's bout.
 */
export const roundNotWaiting = (round: number) =>
  new ConflictException({
    message: `The bout does not wait for round ${round} to start`,
    code: ROUND_NOT_WAITING,
  });

/**
 * The late "Start round N+1" or "End round" a body names, or null for the body
 * of the pad of before. All four fields or none, for the reason `latePressOf`
 * gives.
 */
export function lateRoundPressOf(body: {
  clientUuid?: string;
  round?: number;
  pressedAt?: string;
  sentAt?: string;
}): LateRoundPress | null {
  const { clientUuid, round, pressedAt, sentAt } = body;
  if ([clientUuid, round, pressedAt, sentAt].every((field) => field === undefined)) return null;
  if (!clientUuid || !round || !pressedAt || !sentAt) {
    throw new BadRequestException(
      'A round press with an id names its id, its round, ' +
        'the time of the press and the time of the send',
    );
  }
  return { clientUuid, round, pressedAt, sentAt };
}

async function readBout(db: Database, matchId: string): Promise<Record<string, unknown>> {
  const { data } = await db.from('matches').select(BOUT_COLUMNS).eq('id', matchId).maybeSingle();
  if (!data) throw new NotFoundException(`Match ${matchId} not found`);
  return data as unknown as Record<string, unknown>;
}

const roundOf = (bout: Record<string, unknown>): number =>
  (bout['current_round'] as number | null) ?? 1;

const advanceTo = (round: number) =>
  ({ type: 'round_advance', reason: `advance to round ${round}` }) as const;

/**
 * Where the bout stands for `round`, read again before each clock step (S2): it still `waits`
 * for it; another send of the advance `opened` it (the bout row is the last write of an advance,
 * so it says "done"); it `moved` back, by a reset or a Reopen of the round before; or it was
 * `completed`, by a forfeit, which leaves `awaiting_round_advance` as it was. Read as waiting,
 * the advance's Reopen of the ended clock un-completed the bout and voided the forfeit.
 */
type Waiting = 'waits' | 'opened' | 'moved' | 'completed';

async function waitingFor(db: Database, matchId: string, round: number): Promise<Waiting> {
  const { data, error } = await db
    .from('matches')
    .select('status, current_round, awaiting_round_advance')
    .eq('id', matchId)
    .maybeSingle();
  if (error) throw new Error(`Bout ${matchId} not read before its clock: ${error.message}`);
  const bout = data as {
    status: string;
    current_round: number | null;
    awaiting_round_advance: boolean;
  } | null;
  if (bout?.status === 'completed') return 'completed';
  const current = bout?.current_round ?? 1;
  if (bout?.awaiting_round_advance === true && current === round - 1) return 'waits';
  return current >= round ? 'opened' : 'moved';
}

/**
 * Put the clock to zero for the new round: halt or reopen as needed, then
 * reset. `at`: the time of a late advance; none is now. Not `reset` when the
 * bout stopped waiting meanwhile (`waitingFor`): nothing more is touched.
 *
 * The race (S2, operator 2026-10-16): two sends of one "Start round 2" pass
 * their rules while the bout waits. The first opens the round and the referee
 * presses Start; the second, reset then, put round 2's clock back to 0:00 under
 * the fight. So each step asks the bout again just before it. What is left is
 * the few milliseconds between that read and the step, before the first send's
 * answer has even reached the pad: no Start can land in it.
 *
 * A failure is an error, and a plain one (operator, 2026-10-10): the bout row
 * has not moved, and a pad sends a 5xx again by itself. Swallowed, the round
 * opened with the time of the round before on its clock, and nobody was told.
 */
async function resetClock(
  deps: AdvanceDeps,
  matchId: string,
  round: number,
  actor: Actor | undefined,
  at?: string,
): Promise<'reset' | Exclude<Waiting, 'waits'>> {
  const { clock } = deps;
  const opensLock = { ...actor, canOverrideLocked: true };
  const step = async (action: 'halt' | 'reopen' | 'reset_clock', reason: string) => {
    const now = await waitingFor(deps.db, matchId, round);
    if (now === 'waits') await clock.clockAction(matchId, action, reason, opensLock, false, at);
    return now;
  };
  try {
    const first = await waitingFor(deps.db, matchId, round);
    if (first !== 'waits') return first;
    const before = await clock.getClockState(matchId);
    const halt = before.status === 'running' ? 'halt' : before.status === 'ended' ? 'reopen' : null;
    const halted = halt ? await step(halt, 'round advance') : 'waits';
    if (halted !== 'waits') return halted;
    const after = await clock.getClockState(matchId);
    const zero = after.status === 'halted' ? await step('reset_clock', 'next round') : 'waits';
    return zero === 'waits' ? 'reset' : zero;
  } catch (err) {
    // Any other failure is a fault the pad sends again. A bout completed while this round opened
    // is not: a resend would be answered "saved". It stays `bout_completed`, which the pad holds.
    if (
      err instanceof ConflictException &&
      (err.getResponse() as { code?: unknown }).code === BOUT_COMPLETED
    ) {
      throw err;
    }
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(`Clock of bout ${matchId} not put to zero for round ${round}: ${why}`, {
      cause: err,
    });
  }
}

/**
 * The clock at zero, then the bout in its new round, then its sheet read again. `sequence`: this
 * advance's row. A bout that moved back or was completed meanwhile takes it back and refuses:
 * left in the timeline, a `round_advance` row puts the level chain of the round before back to
 * its top, and a resend was answered "taken".
 */
async function openRound(
  deps: AdvanceDeps,
  matchId: string,
  round: number,
  actor: Actor | undefined,
  { sequence, at }: { sequence: number; at?: string },
): Promise<{ currentRound: number }> {
  const clockAt = await resetClock(deps, matchId, round, actor, at);
  if (clockAt === 'opened') return { currentRound: round };
  if (clockAt === 'moved') await takeBackRow(deps.db, matchId, sequence, roundNotWaiting(round));
  if (clockAt === 'completed') await takeBackRow(deps.db, matchId, sequence, boutCompleted());
  const { error } = await deps.db
    .from('matches')
    .update({
      current_round: round,
      awaiting_round_advance: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', matchId);
  if (error) {
    throw new Error(
      `Round ${round} is in the timeline, bout ${matchId} not updated: ${error.message}`,
    );
  }
  await deps.recompute(matchId);
  return { currentRound: round };
}

/** The pad of before: the next round, now. Its two refusals keep their words. */
async function advanceNow(
  deps: AdvanceDeps,
  matchId: string,
  actor: Actor | undefined,
): Promise<{ currentRound: number }> {
  const bout = await readBout(deps.db, matchId);
  if (!bout['awaiting_round_advance']) {
    throw new BadRequestException('No round is awaiting advance');
  }
  if (bout['status'] === 'completed') {
    throw new BadRequestException('Match is already completed');
  }
  const round = roundOf(bout) + 1;
  const sequence = await writeRoundRow(deps.db, matchId, advanceTo(round), actor);
  return openRound(deps, matchId, round, actor, { sequence });
}

/**
 * An advance the server holds, on a bout that no longer waits for it: answered with the bout's
 * round. The count is the last step of `openRound`. When it failed, the round is open with the
 * score of the round before on the bout's row, and this press came back as an error: its next
 * send finishes the count here. Only while that round holds nothing (`unfinished`, and an empty
 * sheet): the tablet's own hits of it wait behind this press. A round that was fought is left
 * alone. Its sheet may be at the cap, and a count would close it again under a referee who has
 * just put it back in play (as `ScoringService.clockAction` says).
 */
async function answerSavedAdvance(
  deps: AdvanceDeps,
  matchId: string,
  round: number,
  bout: { current: number; unfinished: boolean },
): Promise<{ currentRound: number }> {
  if (bout.unfinished && (await nothingOnTheSheet(deps.db, matchId, round))) {
    await deps.recompute(matchId);
  }
  return { currentRound: bout.current };
}

/**
 * Take an advance a pad sends late. The order of the rules is the design:
 *
 *   1. An advance the server holds, on a bout that no longer waits for it, is
 *      answered. No rule below may answer it: the pad reads a refusal as
 *      "never taken" and sends it for ever. A completed bout waits for
 *      nothing, and nothing is finished on an over Event: an advance cut short
 *      there stays cut short, and writes nothing more. A bout that is in the
 *      round this press opened, with nothing on that round's sheet yet, has
 *      its score counted once more: the count is the one step of an advance
 *      that can fail after the round is open.
 *   2. A new one: an over Event refuses it, to everybody. A round that is
 *      already open is done, and writes nothing (another tablet opened it). A
 *      completed bout takes none, and a press older than one day is not applied.
 *      One from before the bout was last put back in play is for the bout as
 *      it was before somebody corrected it (`press-before-reopen.ts`). Not one
 *      the server holds: its bout still waits for that round.
 *   3. A press from before the bout's last reset is for the fight that was
 *      cancelled. Also for one the server holds: the bout may wait at the same
 *      round again, in its new fight.
 *   4. A new one: the bout must wait for exactly this round.
 *   5. Its row, at the server's time of the press and never before the row the
 *      bout ends with. An advance the server holds, whose bout still waits, was
 *      cut short after its row: it is finished from here.
 */
async function advanceLate(
  deps: AdvanceDeps,
  matchId: string,
  actor: Actor | undefined,
  late: LateRoundPress,
): Promise<{ currentRound: number }> {
  const { db } = deps;
  // The body is also the one of "End round", which round 1 has. No press opens it.
  if (late.round < 2) throw new BadRequestException('No press opens round 1');
  const asked = { clientUuid: late.clientUuid, matchId, type: 'round_advance' } as const;
  const savedRow = await savedRoundPress(db, asked);
  const saved = savedRow !== null;
  const sequence = await nextSequence(db, matchId); // Before the reads that judge it (S11).
  const bout = await readBout(db, matchId);
  const current = roundOf(bout);
  const completed = bout['status'] === 'completed';
  const over = isOver(eventStatusOf(bout));
  // A forfeit completes a bout and leaves `awaiting_round_advance` as it was.
  const waits = bout['awaiting_round_advance'] === true && current === late.round - 1 && !completed;
  if (saved && (!waits || over)) {
    const unfinished = !over && !completed && current === late.round;
    return answerSavedAdvance(deps, matchId, late.round, { current, unfinished });
  }

  const nowMs = Date.now();
  const pressedMs = pressedAtServer(late, nowMs);
  if (!saved) {
    if (over) throw eventResultsFrozen();
    if (current >= late.round) return { currentRound: current };
    if (completed) throw boutCompleted();
    if (nowMs - pressedMs > OLDEST_PRESS_MS) throw pressTooOld();
    assertPressedAfterBackInPlay(matchId, bout['back_in_play_at'], pressedMs);
  }
  await assertScoredAfterLastReset(db, matchId, new Date(pressedMs).toISOString());
  if (!saved && !waits) throw roundNotWaiting(late.round);

  const at = await placedInTimeline(db, matchId, pressedMs);
  const row = { ...late, at, sequence };
  const written = savedRow
    ? savedRow.sequence
    : await writeRoundRow(db, matchId, advanceTo(late.round), actor, row);
  return openRound(deps, matchId, late.round, actor, { sequence: written, at });
}

/**
 * Advance a best-of bout to its next round.
 *
 * Two writers on one bout: another tablet, or the server's own Halt, can write
 * a row between a late advance's rules and its insert. The insert then fails
 * on a unique key, and EVERY rule is asked again: the row that won may have
 * opened the round or ended the bout. After three tries the pad sends it again.
 */
export async function advanceRound(
  deps: AdvanceDeps,
  matchId: string,
  actor?: Actor,
  late?: LateRoundPress | null,
): Promise<{ currentRound: number }> {
  if (!late) return advanceNow(deps, matchId, actor);
  return againOnCollision(() => advanceLate(deps, matchId, actor, late));
}
