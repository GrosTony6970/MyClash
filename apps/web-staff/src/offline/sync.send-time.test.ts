/**
 * A hit or a card says how old it is when the tablet sends it (the offline
 * bout, slice 3).
 *
 * A table has no wifi. With the clock running, the official gives a black
 * card, which ends the bout. The card reaches the server an hour later, and
 * the server ends the clock by itself. It must end it at the time of the card.
 * The server never reads the time of day a tablet says, so the tablet sends
 * the card's own time and a send time that is that time plus the card's age,
 * measured as the age of a clock press is (`press-age.ts`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db, type OutboxEntry } from './db';
import { enqueue, quarantine, queueCard, requeueRejected, requeueRejectedEntry } from './outbox';
import { SyncEngine } from './sync';
import { API_URL, AT_TEN, BOUT, addHit, clearStore, mockServer } from './sync.press.fixtures';

const TWENTY_MINUTES = 20 * 60_000;
const AT_TEN_ISO = '2026-10-10T10:00:00.000Z';

beforeEach(clearStore);

function addCard(): Promise<number> {
  return enqueue({
    kind: 'penalty',
    clientUuid: crypto.randomUUID(),
    matchId: 'm1',
    sequence: 1,
    registrationId: 'reg-red',
    occurredAt: AT_TEN_ISO,
    directCard: 'black',
    reason: 'struck after the halt',
    bout: BOUT,
  });
}

/** The tablet sends its queue when its time of day reads `wall`. */
async function sendAt(wall: number) {
  const server = mockServer();
  vi.spyOn(Date, 'now').mockReturnValue(wall);
  await new SyncEngine(API_URL).drain();
  return server;
}

describe('a hit or a card written on the tablet', () => {
  it.each([
    ['a hit', () => addHit()],
    ['a card', () => queueCard({ matchId: 'm1', sequence: 1, registrationId: 'reg-red' })],
  ])('%s keeps the page’s own clock of the tap, as a clock press does', async (_, write) => {
    const before = performance.now();

    const row = await db.outbox.get(await write());

    expect(row?.pressOrigin).toBe(performance.timeOrigin);
    expect(row?.pressedPerf).toBeGreaterThanOrEqual(before);
    expect(row?.pressedPerf).toBeLessThanOrEqual(performance.now());
  });

  it.each([
    ['its own Retry', (heldId: number) => requeueRejectedEntry(heldId)],
    ['the Retry of the bar', () => requeueRejected()],
  ])('keeps it through the inbox, by %s: a held hit has the age of its tap', async (_, retry) => {
    const id = await addHit();
    const written = (await db.outbox.get(id)) as OutboxEntry;
    await quarantine(id, 'the API’s words', 'match_locked');
    const [held] = await db.rejected.toArray();

    await retry(held?.id as number);

    expect(await db.outbox.toArray()).toEqual([
      expect.objectContaining({
        pressedPerf: written.pressedPerf,
        pressOrigin: written.pressOrigin,
        occurredAt: written.occurredAt,
      }),
    ]);
  });
});

describe('the send of a hit or a card', () => {
  it.each([
    ['a hit', 'exchanges m1', addHit],
    ['a card', 'penalties m1', addCard],
  ])(
    '%s made 20 minutes ago says so: its own time, and a send time 20 minutes later',
    async (_, door, add) => {
      await add();

      const { calls, bodies } = await sendAt(AT_TEN.wall + TWENTY_MINUTES);

      expect(calls).toEqual([door]);
      expect(bodies[0]).toMatchObject({
        occurredAt: AT_TEN_ISO,
        sentAt: '2026-10-10T10:20:00.000Z',
      });
    },
  );

  it('reads the page’s own clock when the time of day was set back meanwhile', async () => {
    // The tablet's time of day was an hour ahead at the tap, and the network
    // corrected it before the send: by the time of day the hit is "not made yet".
    const id = await addHit();
    await db.outbox.update(id, { pressedPerf: performance.now() - TWENTY_MINUTES });

    const { bodies } = await sendAt(AT_TEN.wall - 60 * 60_000);

    const age = Date.parse(bodies[0]?.['sentAt'] as string) - AT_TEN.wall;
    expect(age).toBeGreaterThanOrEqual(TWENTY_MINUTES);
    expect(age).toBeLessThan(TWENTY_MINUTES + 5_000);
  });

  it('a hit the tablet held before it kept the page’s clock says its age by the time of day', async () => {
    await db.outbox.add({
      clientUuid: crypto.randomUUID(),
      matchId: 'm1',
      sequence: 1,
      type: 'double',
      occurredAt: AT_TEN_ISO,
      createdAt: AT_TEN.wall,
      attempts: 0,
    });

    const { bodies } = await sendAt(AT_TEN.wall + TWENTY_MINUTES);

    expect(bodies[0]).toMatchObject({ occurredAt: AT_TEN_ISO, sentAt: '2026-10-10T10:20:00.000Z' });
  });

  it('a second try under a new sequence says the age too', async () => {
    await addHit();
    const server = mockServer((call, nth) =>
      call === 'exchanges m1' && nth === 1
        ? { status: 400, body: { message: 'taken' } }
        : undefined,
    );
    vi.spyOn(Date, 'now').mockReturnValue(AT_TEN.wall + TWENTY_MINUTES);

    await new SyncEngine(API_URL).drain();

    expect(server.calls).toEqual(['exchanges m1', 'exchanges m1']);
    expect(server.bodies.map((body) => body['sentAt'])).toEqual([
      '2026-10-10T10:20:00.000Z',
      '2026-10-10T10:20:00.000Z',
    ]);
  });
});
