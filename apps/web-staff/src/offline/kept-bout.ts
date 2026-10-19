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
import { withHeldRules } from '../lib/bout-read';
import { db } from './db';

const keyOf = (matchId: string) => `bout/${matchId}`;
const clockKeyOf = (matchId: string) => `clock/${matchId}`;

/** The two lists of a bout the tablet keeps, named as their routes are. */
export type BoutListName = 'exchanges' | 'penalties';
const listKeyOf = (matchId: string, list: BoutListName) => `${list}/${matchId}`;

export interface KeptBout {
  match: MatchInfo;
  /** When the server gave this bout (ms). */
  readAt: number;
}

/**
 * Keeps the bout a read of the server gave, asked at `askedAt`. One bout of
 * `keepBoutsAskedAt`, under its rule. `startedUnder`: the copy a Start of it
 * that waited when the read was asked names (`unsentStarts`).
 */
export async function keepBout(
  match: MatchInfo,
  askedAt: number,
  startedUnder: string | undefined,
): Promise<void> {
  const waiting = new Map(startedUnder === undefined ? [] : [[match.id, startedUnder]]);
  await keepBoutsAskedAt([match], askedAt, waiting);
}

/**
 * Keeps bouts that ONE read of the server gave, asked at `askedAt`: the bout
 * screen's read of its bout, or the read of a whole piste
 * (`lib/keep-piste.ts`). Answers how many were written.
 *
 * THE RACE. Both reads write a bout's copy, and either answer can land last:
 * the piste read is slow, and the screen reads its bout again after every
 * send. So an answer never replaces a copy of a LATER ask. Read and written
 * in one transaction, or another write could land between the two.
 *
 * The copy takes the time of the ask: that is how old its word is. An answer
 * without the bout's rules keeps the rules the copy holds, and so does a
 * `scheduled` answer for a bout whose Start waits (`withHeldRules`).
 * `waiting` is read by the caller BEFORE its read (`unsentStarts`):
 * the Start leaves the queue only once the server took it, and nothing outside
 * `reads` is opened in this transaction.
 */
export async function keepBoutsAskedAt(
  matches: MatchInfo[],
  askedAt: number,
  waiting: ReadonlyMap<string, string>,
): Promise<number> {
  return db.transaction('rw', db.reads, async () => {
    const paths = matches.map((match) => keyOf(match.id));
    const held = await db.reads.bulkGet(paths);
    const rows = matches
      .map((match, i) => ({
        path: paths[i]!,
        body: withHeldRules(match, held[i]?.body as MatchInfo | undefined, waiting.get(match.id)),
        fetchedAt: askedAt,
      }))
      .filter((_row, i) => !held[i] || held[i].fetchedAt <= askedAt);
    await db.reads.bulkPut(rows);
    return rows.length;
  });
}

/** The copy of that bout, or null when the tablet never read it. */
export async function keptBout(matchId: string): Promise<KeptBout | null> {
  const row = await db.reads.get(keyOf(matchId));
  return row ? { match: row.body as MatchInfo, readAt: row.fetchedAt } : null;
}

/** The server said there is no such bout (a 404): its copy must not open again. */
export async function forgetBout(matchId: string): Promise<void> {
  await db.reads.bulkDelete([
    keyOf(matchId),
    clockKeyOf(matchId),
    listKeyOf(matchId, 'exchanges'),
    listKeyOf(matchId, 'penalties'),
  ]);
}

/**
 * Keeps the hits or the cards the server just listed for a bout. A bout opened
 * with no network shows them under the tablet's queue: without them the
 * timeline, the doubles count and the card counts hold the queue alone, and a
 * hit the server already has is counted again from the queue.
 */
export async function keepList(
  matchId: string,
  list: BoutListName,
  rows: unknown[],
): Promise<void> {
  await db.reads.put({ path: listKeyOf(matchId, list), body: rows, fetchedAt: Date.now() });
}

/** The copy of that list, or null when the tablet never read it. */
export async function keptList<T>(matchId: string, list: BoutListName): Promise<T[] | null> {
  const row = await db.reads.get(listKeyOf(matchId, list));
  return row ? (row.body as T[]) : null;
}

/**
 * Keeps the clock the server just gave for a bout. A bout opened with no
 * network starts its clock from this, then adds the presses the tablet holds:
 * without it a bout paused at 1:20 would open at 0:00.
 */
export async function keepClock(matchId: string, clock: ClockState): Promise<void> {
  await db.reads.put({ path: clockKeyOf(matchId), body: clock, fetchedAt: Date.now() });
}

/**
 * Which of these bouts the tablet holds the clock of: the bouts its own screen
 * opened with a network. A bout in play with no kept clock would open at 0:00.
 */
export async function clocksHeld(matchIds: string[]): Promise<Set<string>> {
  const rows = await db.reads.bulkGet(matchIds.map(clockKeyOf));
  return new Set(matchIds.filter((_id, i) => rows[i] !== undefined));
}

/** The copy of that bout's clock, or null when the tablet never read it. */
export async function keptClock(matchId: string): Promise<ClockState | null> {
  const row = await db.reads.get(clockKeyOf(matchId));
  return row ? (row.body as ClockState) : null;
}
