/**
 * A clock press in the tablet's queue (operator rulings 2 and 11 to 14 of the
 * quick-win list, and ruling A of 2026-10-10: the clock always acts at once).
 *
 * A press is a row of the same queue as the hits and the cards, so the server
 * gets a bout in the order it happened: the Start before the hits, the hits
 * before the End. It is no hit: its sequence is 0, which no hit holds and which
 * never moves the bout's next number.
 *
 * The send is `press-send.ts`; this is the store.
 */
import type { ClockPress } from '@myclash/types';
import { db, kindOf, type BoutNames, type OutboxEntry, type RejectedEntry } from './db';
import { tabletTime, type TabletTime } from './press-age';

/** Writes one tap on a clock button on the tablet. Returns its row. */
export async function queuePress(
  press: {
    matchId: string;
    action: ClockPress;
    bout: BoutNames;
    /** Of an End: the score on the screen at the tap. */
    endScore?: { red: number; blue: number };
  },
  at: TabletTime = tabletTime(),
): Promise<OutboxEntry> {
  const row: OutboxEntry = {
    kind: 'press',
    clientUuid: crypto.randomUUID(),
    matchId: press.matchId,
    sequence: 0,
    occurredAt: new Date(at.wall).toISOString(),
    pressAction: press.action,
    pressedPerf: at.page,
    pressOrigin: at.origin,
    bout: press.bout,
    ...(press.endScore ? { endScore: press.endScore } : {}),
    createdAt: at.wall,
    attempts: 0,
  };
  return { ...row, id: await db.outbox.add(row) };
}

/** The server took the press: it leaves the queue. A press is never undone, so nothing is kept. */
export async function dropSentPress(id: number): Promise<void> {
  await db.outbox.delete(id);
}

/** Does a tap of the clock wait on the tablet? A send answered "nobody is signed in" asks. */
export async function holdsPress(): Promise<boolean> {
  const rows = await db.outbox.toArray();
  return rows.some((row) => kindOf(row) === 'press');
}

/** The bouts that hold a refused press: their rows wait behind it. */
export async function boutsBehindHeldPress(): Promise<Set<string>> {
  const held = await db.rejected.toArray();
  return new Set(held.filter((row) => kindOf(row) === 'press').map((row) => row.matchId));
}

/** The refused presses of one bout, oldest first: what the bout's screen says at the clock. */
export async function heldPressesOf(matchId: string): Promise<RejectedEntry[]> {
  const held = await db.rejected.where('matchId').equals(matchId).sortBy('id');
  return held.filter((row) => kindOf(row) === 'press');
}

/** How many rows of its bout wait in the queue behind a refused press. */
export async function waitingBehind(
  held: Pick<RejectedEntry, 'matchId' | 'outboxId'>,
): Promise<number> {
  const rows = await db.outbox.where('matchId').equals(held.matchId).toArray();
  return rows.filter((row) => (row.id ?? 0) > (held.outboxId ?? 0)).length;
}
