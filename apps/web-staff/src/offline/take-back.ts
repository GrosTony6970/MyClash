import { db, type OutboxEntry } from './db';
import { dequeueNewestForMatch, removeUnsent } from './outbox';

/**
 * The tablet's half of the undo (ruling 317): take back the newest hit or card
 * that waits for a bout, while a send may be running.
 *
 * Three answers. `removed`: it never reached the server and is gone from the
 * tablet. `landed`: it was on its way when the undo was tapped, its answer was
 * waited for, and the server holds it under `serverId`: the caller voids it
 * there. `none`: nothing waited, so the newest entry is the server's.
 */
export type TakenBack =
  { kind: 'removed' } | { kind: 'landed'; entry: OutboxEntry; serverId: string } | { kind: 'none' };

/** What the undo asks of the send: which row is out, and when its answer is filed. */
export interface SendInFlight {
  isOnItsWay(id: number): boolean;
  whenFiled(): Promise<unknown>;
}

/** A tablet where nothing sends. */
const NOBODY_SENDS: SendInFlight = {
  isOnItsWay: () => false,
  whenFiled: () => Promise.resolve(),
};

export async function takeBackNewest(
  matchId: string,
  send: SendInFlight = NOBODY_SENDS,
): Promise<TakenBack> {
  const found = await dequeueNewestForMatch(matchId, send.isOnItsWay);
  if (!found) return { kind: 'none' };
  if ('removed' in found) return { kind: 'removed' };
  return afterItsAnswer(found.onItsWay, send);
}

/**
 * The entry was out when the undo was tapped. Its answer decides: taken by
 * the server, or still on the tablet (failed, or held as refused), where it is
 * removed. A new send can claim it again before that removal: wait again.
 */
async function afterItsAnswer(entry: OutboxEntry, send: SendInFlight): Promise<TakenBack> {
  for (;;) {
    // A send that threw (the store failed) is the undo's failure too: nothing is known.
    await send.whenFiled();
    const landed = await db.synced.get(entry.clientUuid);
    if (landed) return { kind: 'landed', entry, serverId: landed.serverId };
    if ((await removeUnsent(entry, send.isOnItsWay)) === 'removed') return { kind: 'removed' };
  }
}
