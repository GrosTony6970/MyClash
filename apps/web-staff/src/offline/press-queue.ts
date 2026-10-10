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

/**
 * The bouts that hold a refused row: their rows wait behind it. A hit or a
 * card as much as a press (operator, 2026-10-10): an End sent past a held hit
 * would end the bout on the server without it.
 */
export async function boutsBehindHeldRow(): Promise<Set<string>> {
  const held = await db.rejected.toArray();
  return new Set(held.map((row) => row.matchId));
}

/** The refused rows of one bout, oldest first: what the bout's screen says at the clock. */
export function heldRowsOf(matchId: string): Promise<RejectedEntry[]> {
  return db.rejected.where('matchId').equals(matchId).sortBy('id');
}

/** The refused presses of one bout, oldest first. */
export async function heldPressesOf(matchId: string): Promise<RejectedEntry[]> {
  return (await heldRowsOf(matchId)).filter((row) => kindOf(row) === 'press');
}

/** Does a row of its bout wait in the queue behind this held row? Asked before its Discard. */
export async function holdsBack(heldId: number): Promise<boolean> {
  const held = await db.rejected.get(heldId);
  return held !== undefined && (await waitingBehind(held)) > 0;
}

/**
 * How many rows of its bout wait in the queue behind a refused row: every
 * queued row of the bout, as `BoutOrder` holds them all. A row with a place
 * BEFORE the held one waits too: a hit that met a server fault stays queued
 * while the hit after it goes and is refused.
 */
export function waitingBehind(held: Pick<RejectedEntry, 'matchId'>): Promise<number> {
  return db.outbox.where('matchId').equals(held.matchId).count();
}

/**
 * How many queued rows a send can try now: the ones of a bout that holds no
 * refused row. The bar offers Retry only while this, or a curable held row,
 * gives it something to do (ruling 291).
 */
export async function freeToSend(held: readonly Pick<RejectedEntry, 'matchId'>[]): Promise<number> {
  const waits = new Set(held.map((row) => row.matchId));
  const rows = await db.outbox.toArray();
  return rows.filter((row) => !waits.has(row.matchId)).length;
}
