/**
 * The store's half of the pad's undo (rulings 317, 318).
 *
 * A queued hit or card has not reached the server, so undoing it is a local
 * delete rather than a void: that is what lets the undo work offline. The
 * newest entry goes, a card as well as a hit, and never the row a send has
 * out: that one may already be on the server.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import {
  claimForSend,
  dequeueNewestForMatch,
  enqueue,
  nextSequence,
  pendingCount,
  quarantine,
  queueCard,
  removeUnsent,
  requeueRejected,
} from './outbox';

beforeEach(async () => {
  await db.outbox.clear();
  await db.synced.clear();
  await db.rejected.clear();
});

const AT = (minute: number) => `2026-10-06T10:${String(minute).padStart(2, '0')}:00.000Z`;

function queue(matchId: string, sequence: number, occurredAt = AT(sequence)) {
  return enqueue({
    clientUuid: `uuid-${matchId}-${sequence}`,
    matchId,
    sequence,
    type: 'clean',
    occurredAt,
    firstStrikerColor: 'red',
    firstStrikeValue: 1,
  });
}

describe('dequeueNewestForMatch', () => {
  it('removes the newest queued hit and hands it back', async () => {
    await queue('match-1', 1);
    await queue('match-1', 2);

    const found = await dequeueNewestForMatch('match-1');

    expect(found).toMatchObject({ removed: { sequence: 2 } });
    expect(await pendingCount('match-1')).toBe(1);
  });

  it('removes a card when the card is the newest (ruling 318)', async () => {
    await queue('match-1', 1);
    await queueCard({
      matchId: 'match-1',
      sequence: 2,
      registrationId: 'reg-red',
      directCard: 'red',
    });

    const found = await dequeueNewestForMatch('match-1');

    expect(found).toMatchObject({ removed: { kind: 'penalty', directCard: 'red' } });
  });

  it('newest is the last line of the list, not the last row added', async () => {
    // A held hit sent again is added last, with a new sequence, and was scored first.
    await queue('match-1', 1, AT(30));
    await queue('match-1', 2, AT(5));

    const found = await dequeueNewestForMatch('match-1');

    expect(found).toMatchObject({ removed: { clientUuid: 'uuid-match-1-1' } });
  });

  it('two entries of one instant: the higher sequence is the newest', async () => {
    await queue('match-1', 1, AT(5));
    await queue('match-1', 2, AT(5));

    expect(await dequeueNewestForMatch('match-1')).toMatchObject({ removed: { sequence: 2 } });
  });

  it('answers null when nothing is queued: the newest entry is the server’s', async () => {
    expect(await dequeueNewestForMatch('match-1')).toBeNull();
  });

  it('never reaches into another match’s queue', async () => {
    await queue('match-1', 1);
    await queue('match-2', 1);

    await dequeueNewestForMatch('match-1');

    expect(await pendingCount('match-1')).toBe(0);
    expect(await pendingCount('match-2')).toBe(1);
  });

  it('lets nextSequence fall back, so the next hit reuses the number', async () => {
    await queue('match-1', 1);
    await queue('match-1', 2);
    expect(await nextSequence('match-1')).toBe(3);

    await dequeueNewestForMatch('match-1');

    expect(await nextSequence('match-1')).toBe(2);
  });

  it('undoes repeatedly, down to an empty queue', async () => {
    await queue('match-1', 1);
    await queue('match-1', 2);

    expect(await dequeueNewestForMatch('match-1')).not.toBeNull();
    expect(await dequeueNewestForMatch('match-1')).not.toBeNull();
    expect(await dequeueNewestForMatch('match-1')).toBeNull();
  });

  it('does NOT delete the row a send has out: it hands it back as on its way', async () => {
    await queue('match-1', 1);
    const out = await queue('match-1', 2);

    const found = await dequeueNewestForMatch('match-1', (id) => id === out);

    expect(found).toMatchObject({ onItsWay: { sequence: 2 } });
    expect(await pendingCount('match-1')).toBe(2);
  });

  it('deletes the newest row while an OLDER one is out', async () => {
    const out = await queue('match-1', 1);
    await queue('match-1', 2);

    const found = await dequeueNewestForMatch('match-1', (id) => id === out);

    expect(found).toMatchObject({ removed: { sequence: 2 } });
    expect(await pendingCount('match-1')).toBe(1);
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
    await dequeueNewestForMatch('match-1');
    const noted: number[] = [];

    expect(await claimForSend(id, (claimed) => noted.push(claimed))).toBe(false);
    expect(noted).toEqual([]);
  });
});

describe('removeUnsent', () => {
  const nobody = () => false;

  it('deletes an entry that still waits', async () => {
    const id = await queue('match-1', 1);
    const entry = (await db.outbox.get(id))!;

    expect(await removeUnsent(entry, nobody)).toBe('removed');
    expect(await pendingCount('match-1')).toBe(0);
  });

  it('leaves an entry a new send has claimed', async () => {
    const id = await queue('match-1', 1);
    const entry = (await db.outbox.get(id))!;

    expect(await removeUnsent(entry, (out) => out === id)).toBe('on-its-way');
    expect(await pendingCount('match-1')).toBe(1);
  });

  it('finds an entry a Retry put back in the queue under a new row id', async () => {
    const id = await queue('match-1', 1);
    const entry = (await db.outbox.get(id))!;
    await quarantine(id, 'Match is locked');
    await requeueRejected();

    expect(await removeUnsent(entry, nobody)).toBe('removed');
    expect(await pendingCount('match-1')).toBe(0);
  });

  it('discards the held copy of an entry the server refused, and no other', async () => {
    const id = await queue('match-1', 1);
    const other = await queue('match-1', 2);
    const entry = (await db.outbox.get(id))!;
    await quarantine(id, 'Match is locked');
    await quarantine(other, 'Match is locked');

    expect(await removeUnsent(entry, nobody)).toBe('removed');
    expect((await db.rejected.toArray()).map((held) => held.clientUuid)).toEqual([
      'uuid-match-1-2',
    ]);
  });
});
