import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { isOver } from '../../common/live-status';
import type { SupabaseService } from '../supabase/supabase.service';
import type { ClockService } from './clock.service';
import { eventResultsFrozen } from './event-results-frozen';
import { assertScoredAfterLastReset } from './hit-before-reset';
import {
  againOnCollision,
  boutCompleted,
  ClockRowCollided,
  eventStatusOf,
  OLDEST_PRESS_MS,
  placedInTimeline,
  pressedAtServer,
  pressIsSaved,
  pressTooOld,
  type LatePress,
} from './late-press';

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
  'id, status, awaiting_round_advance, current_round, phases(tournaments(events(status)))';

/** Postgres: a unique key refused the row. */
const UNIQUE_VIOLATION = '23505';

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
 * The late advance a body names, or null for the body of the pad of before.
 * All four fields or none, for the reason `latePressOf` gives.
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
      'A round start with an id names its id, the round it opens, ' +
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

/**
 * Write the `round_advance` row. It is state, not an audit line:
 * `computeClockState` reads it as the marker that puts the level-at-time chain
 * back to the top, so a failed insert is an error. A late one that loses its
 * sequence, or its own id, to another writer says so with `ClockRowCollided`.
 */
async function writeAdvanceRow(
  db: Database,
  matchId: string,
  round: number,
  actor: Actor | undefined,
  late?: { clientUuid: string; at: string },
): Promise<void> {
  const { data: last } = await db
    .from('match_events')
    .select('sequence')
    .eq('match_id', matchId)
    .order('sequence', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await db.from('match_events').insert({
    match_id: matchId,
    sequence: ((last as { sequence: number } | null)?.sequence ?? 0) + 1,
    type: 'round_advance',
    reason: `advance to round ${round}`,
    by_user_id: actor?.userId ?? null,
    staff_account_id: actor?.staffAccountId ?? null,
    occurred_at: late?.at ?? new Date().toISOString(),
    ...(late ? { client_uuid: late.clientUuid } : {}),
  });
  if (!error) return;
  if (late && error.code === UNIQUE_VIOLATION) throw new ClockRowCollided();
  throw new BadRequestException(error.message);
}

/**
 * Put the clock to zero for the new round: halt or reopen as needed, then
 * reset. `at`: the time of a late advance; none is now.
 *
 * A failure is an error, and a plain one (operator, 2026-10-10): the bout row
 * has not moved, and a pad sends a 5xx again by itself. Swallowed, the round
 * opened with the time of the round before on its clock, and nobody was told.
 */
async function resetClock(
  clock: AdvanceDeps['clock'],
  matchId: string,
  round: number,
  actor: Actor | undefined,
  at?: string,
): Promise<void> {
  const opensLock = { ...actor, canOverrideLocked: true };
  try {
    const before = await clock.getClockState(matchId);
    if (before.status === 'running') {
      await clock.clockAction(matchId, 'halt', 'round advance', opensLock, false, at);
    } else if (before.status === 'ended') {
      await clock.clockAction(matchId, 'reopen', 'round advance', opensLock, false, at);
    }
    const after = await clock.getClockState(matchId);
    if (after.status === 'halted') {
      await clock.clockAction(matchId, 'reset_clock', 'next round', opensLock, false, at);
    }
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(`Clock of bout ${matchId} not put to zero for round ${round}: ${why}`, {
      cause: err,
    });
  }
}

/** The clock at zero, then the bout in its new round, then its sheet read again. */
async function openRound(
  deps: AdvanceDeps,
  matchId: string,
  round: number,
  actor: Actor | undefined,
  at?: string,
): Promise<{ currentRound: number }> {
  await resetClock(deps.clock, matchId, round, actor, at);
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
  await writeAdvanceRow(deps.db, matchId, round, actor);
  return openRound(deps, matchId, round, actor);
}

/**
 * Take an advance a pad sends late. The order of the rules is the design:
 *
 *   1. An advance the server holds, on a bout that no longer waits for it, is
 *      answered. No rule below may answer it: the pad reads a refusal as
 *      "never taken" and sends it for ever. A completed bout waits for
 *      nothing, and nothing is finished on an over Event: an advance cut short
 *      there stays cut short, and writes nothing more.
 *   2. A new one: an over Event refuses it, to everybody. A round that is
 *      already open is done, and writes nothing (another tablet opened it). A
 *      completed bout takes none, and a press older than one day is not applied.
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
  const saved = await pressIsSaved(db, late.clientUuid);
  const bout = await readBout(db, matchId);
  const current = roundOf(bout);
  const completed = bout['status'] === 'completed';
  const over = isOver(eventStatusOf(bout));
  // A forfeit completes a bout and leaves `awaiting_round_advance` as it was.
  const waits = bout['awaiting_round_advance'] === true && current === late.round - 1 && !completed;
  if (saved && (!waits || over)) return { currentRound: current };

  const nowMs = Date.now();
  const pressedMs = pressedAtServer(late, nowMs);
  if (!saved) {
    if (over) throw eventResultsFrozen();
    if (current >= late.round) return { currentRound: current };
    if (completed) throw boutCompleted();
    if (nowMs - pressedMs > OLDEST_PRESS_MS) throw pressTooOld();
  }
  await assertScoredAfterLastReset(db, matchId, new Date(pressedMs).toISOString());
  if (!saved && !waits) throw roundNotWaiting(late.round);

  const at = await placedInTimeline(db, matchId, pressedMs);
  if (!saved) {
    await writeAdvanceRow(db, matchId, late.round, actor, { clientUuid: late.clientUuid, at });
  }
  return openRound(deps, matchId, late.round, actor, at);
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
