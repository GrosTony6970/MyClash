/**
 * The round a hit or a card is queued with (the offline bout, slice 4b).
 *
 * With no wifi the official taps "Start round 2" and scores at once. The
 * screen gives each hit its open round, and the screen is one tap behind: it
 * has not drawn round 2 when the first hit of round 2 is tapped. So the store
 * reads the bout's queued "Start round" in the same transaction as the write.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { enqueue, queueCard } from './outbox';
import { SyncEngine } from './sync';
import { API_URL, AT_TEN, BOUT, addRound, clearStore, mockServer } from './sync.press.fixtures';

beforeEach(clearStore);

describe('the round a hit or a card is queued with', () => {
  const hit = (round?: number) =>
    enqueue({
      clientUuid: crypto.randomUUID(),
      matchId: 'm1',
      sequence: 1,
      type: 'clean',
      occurredAt: new Date(AT_TEN.wall).toISOString(),
      firstStrikerColor: 'red',
      firstStrikeValue: 2,
      bout: BOUT,
      ...(round === undefined ? {} : { round }),
    });
  const roundOf = async (id: number) => (await db.outbox.get(id))?.round;

  it('is the round the screen gives', async () => {
    expect(await roundOf(await hit(1))).toBe(1);
  });

  it('is the round a queued "Start round" opens when the screen is one tap behind', async () => {
    await addRound('advance', 2);

    expect(await roundOf(await hit(1)), 'the screen had not drawn round 2 yet').toBe(2);
  });

  it('is the newest such round, and never lower than the screen’s', async () => {
    await addRound('advance', 2);
    await addRound('advance', 3);

    expect(await roundOf(await hit(1))).toBe(3);
    expect(await roundOf(await hit(4)), 'the server opened round 4 meanwhile').toBe(4);
  });

  it('reads only the queued "Start round" of its own bout, and no "End round"', async () => {
    await addRound('advance', 3, 'm2');
    await addRound('end', 5, 'm1');

    expect(await roundOf(await hit(1))).toBe(1);
  });

  it('a card is stamped the same way', async () => {
    await addRound('advance', 2);
    const id = await queueCard({
      matchId: 'm1',
      sequence: 1,
      registrationId: 'reg-1',
      directCard: 'yellow',
      reason: 'late',
      bout: BOUT,
      round: 1,
    });

    expect(await roundOf(id)).toBe(2);
  });

  it('a row queued with no round keeps none: it reads as the server’s open round', async () => {
    await addRound('advance', 2);

    expect(await roundOf(await hit())).toBeUndefined();
  });

  it('is not sent: the server counts a hit in the round open when it arrives', async () => {
    await hit(2);
    const { bodies } = mockServer();

    await new SyncEngine(API_URL).drain();

    expect(bodies[0]).not.toHaveProperty('round');
  });
});
