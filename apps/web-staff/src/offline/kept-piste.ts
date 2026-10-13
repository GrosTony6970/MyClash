/**
 * The piste the tablet keeps: which bouts it holds, in the order of the piste
 * list (quick-win ruling 4, the whole piste).
 *
 * The bouts themselves are the copies of `kept-bout.ts`, one row each, under
 * that file's rule: a copy is shown only when the server cannot be reached, and
 * the screen says so. This row is only the ORDER, so "Next match" knows which
 * copy comes after the bout on screen when the server cannot say.
 *
 * In the `reads` table, under a key of its own, as the copies are.
 */
import type { NextMatchInfo } from '@myclash/ui';
import type { LiceMatchesPayload } from '../components/lice-match-types';
import type { MatchInfo } from '../components/MatchView';
import { db } from './db';
import { keptBout } from './kept-bout';

const keyOf = (liceId: string) => `piste/${liceId}`;
const listKeyOf = (liceId: string) => `lice-matches/${liceId}`;

export interface KeptPiste {
  /** The ids of the piste's bouts, in the order of the piste list. */
  order: string[];
  /** When the server was asked for it (ms). */
  readAt: number;
}

/**
 * Keeps the order a read of the piste gave, asked at `askedAt`.
 *
 * The race: the piste list and a bout screen can both ask, and the answer of
 * the EARLIER ask can land last. It does not replace the later one's order.
 */
export async function keepPiste(liceId: string, order: string[], askedAt: number): Promise<void> {
  await db.transaction('rw', db.reads, async () => {
    const held = await db.reads.get(keyOf(liceId));
    if (held && held.fetchedAt > askedAt) return;
    await db.reads.put({ path: keyOf(liceId), body: order, fetchedAt: askedAt });
  });
}

/** The order the tablet holds for that piste, or null when it never read it. */
export async function keptPiste(liceId: string): Promise<KeptPiste | null> {
  const row = await db.reads.get(keyOf(liceId));
  return row ? { order: row.body as string[], readAt: row.fetchedAt } : null;
}

/**
 * Keeps the list the piste page just read (`GET /staff/lices/:id/matches`): its
 * own rows, with the times and the referees, which a bout's copy does not hold.
 * The page shows it when it opens with no network, and says from when it is.
 */
export async function keepPisteList(liceId: string, list: LiceMatchesPayload): Promise<void> {
  await db.reads.put({ path: listKeyOf(liceId), body: list, fetchedAt: Date.now() });
}

/** The list the tablet holds for that piste and when it was read, or null. */
export async function keptPisteList(
  liceId: string,
): Promise<{ data: LiceMatchesPayload; readAt: number } | null> {
  const row = await db.reads.get(listKeyOf(liceId));
  return row ? { data: row.body as LiceMatchesPayload, readAt: row.fetchedAt } : null;
}

/** The bouts on each side of one bout, as the Next and Previous tiles name them. */
export interface KeptNeighbours {
  previous: NextMatchInfo | null;
  next: NextMatchInfo | null;
}

/**
 * The neighbours of `matchId` in a kept order.
 *
 * The neighbour is the bout NEXT IN THE ORDER, with or without a copy. A bout
 * with no copy (it had no names when the piste was read) gets a tile with no
 * names, and opens "not loaded" with no network. Stepping over it to the next
 * bout that has a copy would send the table to fight the wrong bout.
 */
export function neighboursFromPiste(
  order: readonly string[],
  matchId: string,
  copyOf: (id: string) => MatchInfo | null,
): KeptNeighbours {
  const at = order.indexOf(matchId);
  if (at === -1) return { previous: null, next: null };
  const tile = (id: string | undefined): NextMatchInfo | null => {
    if (!id) return null;
    const copy = copyOf(id);
    return {
      id,
      matchNumberLabel: copy?.matchNumberLabel || null,
      roundCode: copy?.roundCode || null,
      redName: copy?.redFighterName ?? '',
      blueName: copy?.blueFighterName ?? '',
      redClub: copy?.redClub ?? null,
      blueClub: copy?.blueClub ?? null,
    };
  };
  return { previous: tile(order[at - 1]), next: tile(order[at + 1]) };
}

/** The neighbours of a bout from what the tablet holds of its piste, or null when it holds none. */
export async function keptNeighbours(
  liceId: string,
  matchId: string,
): Promise<KeptNeighbours | null> {
  const piste = await keptPiste(liceId);
  if (!piste) return null;
  const at = piste.order.indexOf(matchId);
  const beside = [piste.order[at - 1], piste.order[at + 1]].filter(
    (id): id is string => at !== -1 && Boolean(id),
  );
  const copies = new Map<string, MatchInfo>();
  for (const id of beside) {
    const kept = await keptBout(id);
    if (kept) copies.set(id, kept.match);
  }
  return neighboursFromPiste(piste.order, matchId, (id) => copies.get(id) ?? null);
}
