/**
 * The store's half of the pad's undo (rulings 317, 318, 350).
 *
 * One entry is taken off the tablet, wherever it waits there, and written
 * down: a failed send is not proof the server took nothing. Never the row a
 * send has out, and never an entry the server is known to hold.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { db } from './db';
import {
  claimForSend,
  enqueue,
  markSynced,
  nextSequence,
  pendingCount,
  quarantine,
  queueCard,
  requeueRejected,
  takeOffTablet,
} from './outbox';
import { takeBack } from './take-back';

beforeEach(async () => {
  await db.outbox.clear();
  await db.synced.clear();
  await db.rejected.clear();
  await db.undone.clear();
  vi.restoreAllMocks();
});

const nobody = () => false;

function queue(matchId: string, sequence: number) {
  return enqueue({
    clientUuid: `uuid-${matchId}-${sequence}`,
    matchId,
    sequence,
    type: 'clean',
    occurredAt: `2026-10-06T10:0${sequence}:00.000Z`,
    firstStrikerColor: 'red',
    firstStrikeValue: 1,
  });
}
const row = async (id: number) => (await db.outbox.get(id))!;
const undone = async () => (await db.undone.toArray()).map((entry) => entry.clientUuid);

describe('takeOffTablet', () => {
  it('deletes an entry that waits, and writes it down', async () => {
    const entry = await row(await queue('match-1', 1));
    await queue('match-1', 2);

    expect(await takeOffTablet(entry, nobody)).toBe('removed');

    expect(await pendingCount('match-1')).toBe(1);
    expect(await db.undone.toArray()).toEqual([
      { clientUuid: 'uuid-match-1-1', matchId: 'match-1', undoneAt: expect.any(Number) },
    ]);
  });

  it('takes a card off the tablet as it takes a hit (ruling 318)', async () => {
    const id = await queueCard({
      matchId: 'match-1',
      sequence: 1,
      registrationId: 'reg-red',
      directCard: 'red',
    });

    expect(await takeOffTablet(await row(id), nobody)).toBe('removed');

    expect(await pendingCount('match-1')).toBe(0);
    expect(await db.undone.toArray()).toMatchObject([{ matchId: 'match-1' }]);
  });

  it('does NOT delete the row a send has out, and writes nothing down', async () => {
    const id = await queue('match-1', 1);

    expect(await takeOffTablet(await row(id), (out) => out === id)).toBe('on-its-way');

    expect(await pendingCount('match-1')).toBe(1);
    expect(await undone()).toEqual([]);
  });

  it('names the server’s id of an entry the server took, and writes nothing down', async () => {
    const id = await queue('match-1', 1);
    const entry = await row(id);
    await markSynced(id, entry.clientUuid, 'match-1', 1, 'srv-1');

    expect(await takeOffTablet(entry, nobody)).toEqual({ landed: 'srv-1' });
    expect(await undone()).toEqual([]);
  });

  it('finds an entry a Retry put back in the queue under a new row id', async () => {
    const id = await queue('match-1', 1);
    const entry = await row(id);
    await quarantine(id, 'Match is locked');
    await requeueRejected();

    expect(await takeOffTablet(entry, nobody)).toBe('removed');
    expect(await pendingCount('match-1')).toBe(0);
  });

  it('discards the held copy of an entry the server refused, and no other', async () => {
    const id = await queue('match-1', 1);
    const other = await queue('match-1', 2);
    const entry = await row(id);
    await quarantine(id, 'Match is locked');
    await quarantine(other, 'Match is locked');

    expect(await takeOffTablet(entry, nobody)).toBe('removed');
    expect((await db.rejected.toArray()).map((held) => held.clientUuid)).toEqual([
      'uuid-match-1-2',
    ]);
  });

  it('lets nextSequence fall back, so the next hit reuses the number', async () => {
    await queue('match-1', 1);
    const entry = await row(await queue('match-1', 2));
    expect(await nextSequence('match-1')).toBe(3);

    await takeOffTablet(entry, nobody);

    expect(await nextSequence('match-1')).toBe(2);
  });

  // The race: the send files its answer while the undo decides. Read in one
  // transaction with the delete, "taken by the server" is never read as "waits".
  it('an entry the send files while the undo decides is never read as removed', async () => {
    const id = await queue('match-1', 1);
    const entry = await row(id);
    const read = db.synced.get.bind(db.synced);
    let filing: Promise<void> = Promise.resolve();
    // The send's filing is asked for right after the undo read "not taken yet".
    vi.spyOn(db.synced, 'get').mockImplementationOnce(((key: string) => {
      const found = read(key);
      filing = Dexie.ignoreTransaction(() =>
        markSynced(id, entry.clientUuid, 'match-1', 1, 'srv-1'),
      );
      return found;
    }) as never);

    expect(await takeOffTablet(entry, (out) => out === id)).toBe('on-its-way');
    await filing;

    expect(await takeOffTablet(entry, nobody)).toEqual({ landed: 'srv-1' });
    expect(await undone()).toEqual([]);
  });
});

describe('claimForSend', () => {
  it('notes the claim of a row that still waits', async () => {
    const id = await queue('match-1', 1);
    const noted: number[] = [];

    expect(await claimForSend(id, (claimed) => noted.push(claimed))).toBe(true);
    expect(noted).toEqual([id]);
  });

  it('refuses a row the undo removed, and notes nothing', async () => {
    const id = await queue('match-1', 1);
    await takeOffTablet(await row(id), nobody);
    const noted: number[] = [];

    expect(await claimForSend(id, (claimed) => noted.push(claimed))).toBe(false);
    expect(noted).toEqual([]);
  });
});

describe('requeueRejected', () => {
  // It lists the held entries before its transaction: the undo can remove one between the two.
  it('does not bring back a held entry the undo removed meanwhile', async () => {
    const id = await queue('match-1', 1);
    const entry = await row(id);
    await quarantine(id, 'Match is locked');
    const listed = vi.spyOn(db.rejected, 'orderBy');

    const requeued = requeueRejected();
    await vi.waitFor(() => expect(listed).toHaveBeenCalled());
    await takeOffTablet(entry, nobody);
    await requeued;

    expect(await pendingCount('match-1')).toBe(0);
  });
});

describe('takeBack with no send running', () => {
  it('answers removed for an entry that waits', async () => {
    const entry = await row(await queue('match-1', 1));

    await expect(takeBack(entry)).resolves.toEqual({ kind: 'removed' });
  });

  it('answers landed, with the server’s id, for one the server took', async () => {
    const id = await queue('match-1', 1);
    const entry = await row(id);
    await markSynced(id, entry.clientUuid, 'match-1', 1, 'srv-1');

    await expect(takeBack(entry)).resolves.toEqual({ kind: 'landed', serverId: 'srv-1' });
  });
});
