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
import {
  db,
  isTap,
  type BoutNames,
  type LevelPress,
  type OutboxEntry,
  type PressedOn,
  type RejectedEntry,
  type RoundPress,
  type StartNetwork,
} from './db';
import { isDrillActive } from './drill';
import { tabletTime, type TabletTime } from './press-age';

/**
 * Writes one tap on a clock button on the tablet. Returns its row.
 *
 * A Start keeps the copy of the rules the screen showed (`rulesId`, the bout read's `rules.id`)
 * and what the tablet knows of its network at the tap: none when the page says it is offline, or
 * in the drill (ruled: the drill counts as no network). The rest is learned at the send
 * (`judgeStarts`). Ruling "Offline rules": only a Start pressed with no network keeps the tablet's
 * rules; the server reads both (`startCopyOf`).
 */
export async function queuePress(
  press: {
    matchId: string;
    action: ClockPress;
    bout: BoutNames;
    /** Of an End: the score on the screen at the tap, and the winner it names. */
    endScore?: PressedOn;
    /** Of a Start: the copy of the rules on the screen. None on rules kept before it was sent. */
    rulesId?: string;
    networkStatus: 'online' | 'offline';
  },
  at: TabletTime = tabletTime(),
): Promise<OutboxEntry> {
  const start = press.action === 'start';
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
    ...(start && press.rulesId ? { startedUnder: { rulesId: press.rulesId } } : {}),
    ...(start && (press.networkStatus === 'offline' || isDrillActive())
      ? { startNetwork: 'none' as const }
      : {}),
    createdAt: at.wall,
    attempts: 0,
  };
  return { ...row, id: await db.outbox.add(row) };
}

/** A Start whose network is not yet known: the only rows `judgeStarts` writes. */
const unjudgedStart = (row: OutboxEntry) =>
  row.pressAction === 'start' && row.startNetwork === undefined;

/**
 * What a send learned of the network for Starts tapped before it: `seen` at the first real answer
 * of a pass (the listed Starts), `none` when a Start's own send, or a whole pass, met no network
 * and no answer. Each Start is judged once, by the first send that learns anything after its tap,
 * and never again: a resend says the same. `ids` undefined: every Start in the queue.
 */
export async function judgeStarts(verdict: StartNetwork, ids?: readonly number[]): Promise<void> {
  if (ids?.length === 0) return;
  const rows = ids === undefined ? db.outbox.toCollection() : db.outbox.where(':id').anyOf(ids);
  await rows.filter(unjudgedStart).modify({ startNetwork: verdict });
}

/** The ids of the Starts a pass lists that are not yet judged. */
export function unjudgedStartsOf(pending: readonly OutboxEntry[]): number[] {
  return pending.filter(unjudgedStart).map((row) => row.id!);
}

/**
 * The bouts whose Start the server has not taken (queued, or held in the inbox) and may keep on
 * the copy it names: by bout, that copy. A Start that names none, or that met a network after its
 * tap, takes the copy of now when it lands (`startCopyOf`), so it holds nothing back. Asked BEFORE
 * a read of the bout: the Start leaves the queue only once the server took it, so a read sent
 * after "none waits" sees it taken (`withHeldRules`).
 */
export function unsentStarts(): Promise<Map<string, string>> {
  return db.transaction('r', db.outbox, db.rejected, async () => {
    const rows = [...(await db.outbox.toArray()), ...(await db.rejected.toArray())];
    const keeps = rows.filter(
      (row) => row.pressAction === 'start' && row.startedUnder && row.startNetwork !== 'seen',
    );
    return new Map(keeps.map((row) => [row.matchId, row.startedUnder!.rulesId]));
  });
}

/**
 * Writes one tap on "Start round N" or "End round" on the tablet. `round` is
 * the round an advance OPENS, or the round an end ENDS. Returns its row.
 */
export async function queueRoundPress(
  press: {
    matchId: string;
    action: RoundPress;
    round: number;
    bout: BoutNames;
    /** Of an end: the round's score on the screen at the tap, and the winner it names. */
    endScore?: PressedOn;
  },
  at: TabletTime = tabletTime(),
): Promise<OutboxEntry> {
  const row: OutboxEntry = {
    kind: 'round',
    clientUuid: crypto.randomUUID(),
    matchId: press.matchId,
    sequence: 0,
    occurredAt: new Date(at.wall).toISOString(),
    roundAction: press.action,
    round: press.round,
    pressedPerf: at.page,
    pressOrigin: at.origin,
    bout: press.bout,
    ...(press.endScore ? { endScore: press.endScore } : {}),
    createdAt: at.wall,
    attempts: 0,
  };
  return { ...row, id: await db.outbox.add(row) };
}

/**
 * Writes one tap on the step of a level bout on the tablet: "Extra time 60s"
 * or "Sudden death". `round` is the round it is tapped in. Returns its row.
 */
export async function queueLevelPress(
  press: { matchId: string; round: number; level: LevelPress; bout: BoutNames },
  at: TabletTime = tabletTime(),
): Promise<OutboxEntry> {
  const row: OutboxEntry = {
    kind: 'level',
    clientUuid: crypto.randomUUID(),
    matchId: press.matchId,
    sequence: 0,
    occurredAt: new Date(at.wall).toISOString(),
    level: press.level,
    round: press.round,
    pressedPerf: at.page,
    pressOrigin: at.origin,
    bout: press.bout,
    createdAt: at.wall,
    attempts: 0,
  };
  return { ...row, id: await db.outbox.add(row) };
}

/** The server took the press: it leaves the queue. A press is never undone, so nothing is kept. */
export async function dropSentPress(id: number): Promise<void> {
  await db.outbox.delete(id);
}

/**
 * Does a tap of the clock or of a round button wait on the tablet? A send
 * answered "nobody is signed in" asks.
 */
export async function holdsPress(): Promise<boolean> {
  const rows = await db.outbox.toArray();
  return rows.some(isTap);
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

/** The refused presses of one bout (the clock's and the rounds'), oldest first. */
export async function heldPressesOf(matchId: string): Promise<RejectedEntry[]> {
  return (await heldRowsOf(matchId)).filter(isTap);
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
 * Every row of the bout of a held row leaves the tablet: the refused ones and
 * the ones that wait behind them ("Discard all of this match", operator,
 * 2026-10-11). Answers how many went.
 *
 * The race is the send: a row whose POST is out must not be deleted, or the
 * server holds an entry the tablet forgot. While a bout holds a refused row no
 * row of it is sent (`BoutOrder`), so the proof is that the refused row is
 * still held: it is read again here, in one write transaction with the
 * deletes. Gone (a Retry put it back in the queue): nothing is deleted, and 0
 * is the answer.
 */
export function discardBoutOf(heldId: number): Promise<number> {
  return db.transaction('rw', db.outbox, db.rejected, async () => {
    const held = await db.rejected.get(heldId);
    if (!held) return 0;
    const refused = await db.rejected.where('matchId').equals(held.matchId).delete();
    const waiting = await db.outbox.where('matchId').equals(held.matchId).delete();
    return refused + waiting;
  });
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
