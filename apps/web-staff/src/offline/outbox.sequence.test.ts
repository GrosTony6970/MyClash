/**
 * Two presses inside one send do not share a sequence.
 *
 * The bout screen hands each press its counter, and moves the counter on only
 * after the send. A card given while a hit was on its way carried the hit's
 * number: two cards with one number made the server refuse the second (it was
 * sent again under a new one), and a hit and a card with one number were both
 * taken, with no order between them. The store holds what was queued, so it
 * gives a press the next number when the counter is behind.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { enqueue, getAllPending, queueCard } from './outbox';

beforeEach(async () => {
  await db.outbox.clear();
  await db.synced.clear();
  await db.rejected.clear();
});

function hit(sequence: number, matchId = 'm1') {
  return enqueue({
    clientUuid: crypto.randomUUID(),
    matchId,
    sequence,
    type: 'clean',
    occurredAt: new Date().toISOString(),
    firstStrikerColor: 'red',
    firstStrikeValue: 1,
  });
}

const card = (sequence: number) =>
  queueCard({ matchId: 'm1', sequence, registrationId: 'reg-red', directCard: 'yellow' });

const sequences = async () => (await getAllPending()).map((row) => row.sequence);

describe('a press queued with a counter that is behind', () => {
  it('a second card with the same number gets the next one', async () => {
    await card(4);
    await card(4);

    expect(await sequences()).toEqual([4, 5]);
  });

  it('a hit behind a card with the same number gets the next one', async () => {
    await card(4);
    await hit(4);

    expect(await sequences()).toEqual([4, 5]);
  });

  it('two presses written at the same moment get two numbers', async () => {
    await Promise.all([card(4), hit(4)]);

    expect((await sequences()).sort()).toEqual([4, 5]);
  });

  it('goes after a hit the server took under a later number', async () => {
    // A hit refused for its sequence is sent again under one read from the server.
    await db.synced.add({
      clientUuid: 'uuid-sent-again',
      matchId: 'm1',
      sequence: 12,
      serverId: 'srv-12',
      syncedAt: 0,
    });

    await hit(6);

    expect(await sequences()).toEqual([13]);
  });
});

describe('a press queued with a counter that is right', () => {
  it('keeps a number ahead of the tablet: another pad scored the bout', async () => {
    await hit(9);

    expect(await sequences()).toEqual([9]);
  });

  it('is not moved by the hits of another bout', async () => {
    await hit(7, 'm2');

    await hit(2);

    expect(await sequences()).toEqual([7, 2]);
  });
});
