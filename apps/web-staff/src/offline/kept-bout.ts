/**
 * The copy of a bout the tablet keeps, so a bout can be opened with no network
 * (operator rulings 3, 9 and 10 of the quick-win list).
 *
 * The official reloads the pad in a hall with no wifi. Without a copy the
 * screen can only say "not loaded yet", and the table cannot score. With one,
 * the bout screen opens and the hits go to the queue, as they do when the wifi
 * drops on a bout that was already open.
 *
 * THE RULE. A copy is shown only when the server cannot be reached, and the
 * screen always says so, with the time of the copy. The server's answer
 * replaces it. A copy is never shown as the server's word.
 *
 * It lives in the `reads` table beside the rules the tablet keeps
 * (`cached-reads.ts`), under a key of its own: the row is the bout as the
 * screen holds it, not the body of one request.
 */
import type { MatchInfo } from '../components/MatchView';
import type { ClockState } from '../components/scoreboard-clock';
import { db } from './db';

const keyOf = (matchId: string) => `bout/${matchId}`;
const clockKeyOf = (matchId: string) => `clock/${matchId}`;

export interface KeptBout {
  match: MatchInfo;
  /** When the server gave this bout (ms). */
  readAt: number;
}

/** Keeps the bout a read of the server just gave. Overwrites the copy before it. */
export async function keepBout(match: MatchInfo): Promise<void> {
  await db.reads.put({ path: keyOf(match.id), body: match, fetchedAt: Date.now() });
}

/** The copy of that bout, or null when the tablet never read it. */
export async function keptBout(matchId: string): Promise<KeptBout | null> {
  const row = await db.reads.get(keyOf(matchId));
  return row ? { match: row.body as MatchInfo, readAt: row.fetchedAt } : null;
}

/** The server said there is no such bout (a 404): its copy must not open again. */
export async function forgetBout(matchId: string): Promise<void> {
  await db.reads.bulkDelete([keyOf(matchId), clockKeyOf(matchId)]);
}

/**
 * Keeps the clock the server just gave for a bout. A bout opened with no
 * network starts its clock from this, then adds the presses the tablet holds:
 * without it a bout paused at 1:20 would open at 0:00.
 */
export async function keepClock(matchId: string, clock: ClockState): Promise<void> {
  await db.reads.put({ path: clockKeyOf(matchId), body: clock, fetchedAt: Date.now() });
}

/** The copy of that bout's clock, or null when the tablet never read it. */
export async function keptClock(matchId: string): Promise<ClockState | null> {
  const row = await db.reads.get(clockKeyOf(matchId));
  return row ? (row.body as ClockState) : null;
}
