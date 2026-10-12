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
import { db } from './db';

const keyOf = (liceId: string) => `piste/${liceId}`;

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
