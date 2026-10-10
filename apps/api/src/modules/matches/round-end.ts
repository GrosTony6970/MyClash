import { ConflictException } from '@nestjs/common';
import { isOver } from '../../common/live-status';
import type { SupabaseService } from '../supabase/supabase.service';
import type { ClosedRound } from './closed-round-correction';
import { eventResultsFrozen } from './event-results-frozen';
import { assertScoredAfterLastReset } from './hit-before-reset';
import {
  boutCompleted,
  OLDEST_PRESS_MS,
  placedInTimeline,
  pressedAtServer,
  pressTooOld,
} from './late-press';
import { savedRoundPress, type LateRoundPress } from './round-advance';

type Database = SupabaseService['service'];

/**
 * "End round" on time, sent late by a pad (operator, 2026-10-10).
 *
 * With no network the pad closes the round for the leader itself, as it ends a
 * bout (ruling 11), and keeps the tap in its queue with an id, the round it
 * ENDS and its own two times. `ScoringService.endRoundOnTime` is the door: it
 * asks this file first, then judges the round as it does a press of now.
 */
export const ROUND_NOT_OPEN = 'round_not_open';

/**
 * The bout is in another round than the one this press ends: the pad counted
 * the bout another way. The pad holds the press with the rows of its bout
 * behind it, and shows the server's bout.
 */
export const roundNotOpen = (round: number) =>
  new ConflictException({
    message: `Round ${round} is not the open round of the bout`,
    code: ROUND_NOT_OPEN,
  });

/** What the rules below read of the bout. */
export interface RoundEndBout {
  status: string;
  currentRound: number;
  closed: ClosedRound[];
  eventStatus: string;
}

/** Nothing is left to do, or the round is to be closed at `at`. */
export type LateRoundEnd =
  { done: { redScore: number; blueScore: number } } | { at: string; saved: boolean };

/**
 * Is this the row the bout's timeline ends with? A late "End round" that was
 * cut short wrote its row and nothing after it. A row with something behind it
 * was finished, and a person has put the round back in play since (a Reopen
 * pops the round that decided the series): that round is theirs to end.
 */
async function endsTimeline(db: Database, matchId: string, sequence: number): Promise<boolean> {
  const { data, error } = await db
    .from('match_events')
    .select('sequence')
    .eq('match_id', matchId)
    .order('sequence', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not read the timeline of bout ${matchId}: ${error.message}`);
  return (data as { sequence: number } | null)?.sequence === sequence;
}

/**
 * Does the bout take this late "End round", and where does it go in the
 * timeline? The order of the rules is the one of a late "Start round N+1"
 * (`round-advance.ts`), and for the same reasons:
 *
 *   1. A press the server holds is answered, unless it was cut short (below).
 *      A completed bout has no open round, and nothing is finished on an over
 *      Event.
 *   2. A new one: an over Event refuses it, to everybody. A round already
 *      closed is done, and writes nothing. A completed bout takes none, and a
 *      press older than one day is not applied.
 *   3. A new one from before the bout's last reset is for the fight that was
 *      cancelled. (One the server holds is answered there: the reset's row is
 *      behind its own.)
 *   4. A new one: the bout must be in exactly this round.
 *
 * A press the server holds, whose round is still open and whose row is the
 * last of the bout, was cut short after its row: the caller closes the round
 * and writes no second row (`saved`).
 */
export async function placeLateRoundEnd(
  db: Database,
  matchId: string,
  bout: RoundEndBout,
  late: LateRoundPress,
): Promise<LateRoundEnd> {
  const asked = { clientUuid: late.clientUuid, matchId, type: 'round_end' } as const;
  const row = await savedRoundPress(db, asked);
  const saved = row !== null;
  const snapshot = bout.closed.find((round) => round.round === late.round);
  const done = { done: { redScore: snapshot?.redScore ?? 0, blueScore: snapshot?.blueScore ?? 0 } };
  const completed = bout.status === 'completed';
  const over = isOver(bout.eventStatus);
  const open = bout.currentRound === late.round && !snapshot && !completed;
  if (row && (!open || over || !(await endsTimeline(db, matchId, row.sequence)))) return done;

  const nowMs = Date.now();
  const pressedMs = pressedAtServer(late, nowMs);
  if (!saved) {
    if (over) throw eventResultsFrozen();
    if (snapshot) return done;
    if (completed) throw boutCompleted();
    if (nowMs - pressedMs > OLDEST_PRESS_MS) throw pressTooOld();
    await assertScoredAfterLastReset(db, matchId, new Date(pressedMs).toISOString());
    if (!open) throw roundNotOpen(late.round);
  }
  return { at: await placedInTimeline(db, matchId, pressedMs), saved };
}
