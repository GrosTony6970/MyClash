import type { OutboxEntry } from './db';
import { takeOffTablet } from './outbox';

/**
 * The tablet's half of the undo (rulings 317, 350): take one hit or card off
 * the tablet, while a send may be running. The caller picked the entry.
 *
 * Two answers. `removed`: it is gone from the tablet, and written down until
 * the server was asked for it. `landed`: the server holds it under `serverId`,
 * and the caller voids it there.
 */
export type TakenBack = { kind: 'removed' } | { kind: 'landed'; serverId: string };

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

/**
 * An entry that is out when the undo is tapped is waited for: its answer
 * decides. A new send can claim it again before the removal: wait again.
 */
export async function takeBack(
  entry: OutboxEntry,
  send: SendInFlight = NOBODY_SENDS,
): Promise<TakenBack> {
  for (;;) {
    const found = await takeOffTablet(entry, send.isOnItsWay);
    if (found === 'removed') return { kind: 'removed' };
    if (found !== 'on-its-way') return { kind: 'landed', serverId: found.landed };
    // A send that threw (the store failed) is the undo's failure too: nothing is known.
    await send.whenFiled();
  }
}
