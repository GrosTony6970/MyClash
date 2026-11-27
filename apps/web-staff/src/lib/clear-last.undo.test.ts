import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';

import { db } from '../offline/db';
import { enqueue, getPendingForMatch, queueCard } from '../offline/outbox';
import { pendingRowsForMatch } from '../offline/pending-events';
import type { TakenBack } from '../offline/take-back';
import { newestToUndo } from './clear-last';
import {
  API_URL,
  at,
  BOUT_READ,
  held,
  json,
  server,
  undo,
  uuid,
  voided,
  waiting,
  waits,
  writtenDown,
} from './clear-last.undo.fixtures';
import type { ServerRow } from './server-entries';
import * as settle from './settle-undone';

/**
 * "Undo last entry" asks the server first (ruling 350).
 *
 * Story A: the server saved hit 5 and its answer was lost, so the tablet
 * believes hit 5 still waits. The undo deleted the tablet's copy and the server
 * kept the hit. Story B: hit 4 failed to send and waits, hit 5 was sent. The
 * undo asked the tablet first and removed hit 4.
 */
beforeEach(async () => {
  await db.outbox.clear();
  await db.synced.clear();
  await db.rejected.clear();
  await db.undone.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('story A: the entry that waits on the tablet is on the server', () => {
  it('voids it on the server once, and the tablet’s copy goes', async () => {
    await waits(5);
    const { asked } = server({ hits: [[held('ex-4', 4), held('ex-5', 5)]] });

    await expect(undo()).resolves.toEqual(voided(5, 'ex-5'));

    expect(asked('PATCH')).toEqual(['/exchanges/ex-5/void']);
    expect(await waiting()).toEqual([]);
    expect(await writtenDown()).toEqual([]);
  });

  // The void landed: a fault of the tablet's store must not turn it into a failed undo.
  it('says voided even when the copy could not be taken off the tablet', async () => {
    await waits(5);
    server({ hits: [[held('ex-5', 5)]] });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(undo(() => Promise.reject(new Error('the store failed')))).resolves.toEqual(
      voided(5, 'ex-5'),
    );
    expect(logged).toHaveBeenCalledOnce();
  });

  it('keeps the copy when the server did not void it: a request was filed for review', async () => {
    await waits(5);
    server({ hits: [[held('ex-5', 5)]], voids: () => json(202, { pendingReview: true }) });

    await expect(undo()).resolves.toEqual({ kind: 'sent-for-review' });
    expect(await waiting()).toEqual([uuid(5)]);
  });

  it('the server took it between the read and the removal: found by its id, and voided', async () => {
    await waits(6);
    const { asked } = server({ hits: [[held('ex-5', 5)], [held('ex-5', 5), held('ex-6', 6)]] });

    await expect(undo()).resolves.toEqual(voided(6));

    expect(asked('PATCH')).toEqual(['/exchanges/ex-6/void']);
    expect(await writtenDown()).toEqual([]);
  });
});

describe('story B: an older entry waits, the server holds the newest', () => {
  it('voids the server’s newest hit, and the waiting one stays', async () => {
    await waits(4);
    const { asked } = server({ hits: [[held('ex-5', 5)]] });

    await expect(undo()).resolves.toEqual(voided(5, 'ex-5'));

    expect(asked('PATCH')).toEqual(['/exchanges/ex-5/void']);
    expect(await waiting()).toEqual([uuid(4)]);
  });

  it('voids a card by the card’s route when the card is the newest (ruling 318)', async () => {
    await waits(4);
    const { asked } = server({ hits: [[held('ex-5', 5)]], cards: [held('card-6', 6)] });

    await undo();

    expect(asked('PATCH')).toEqual(['/match-penalties/card-6/void']);
  });

  it('newest is by the time scored, not by the order of the list', async () => {
    const late = held('ex-late', 8, { sequence: 1 });
    const { asked } = server({ hits: [[late, held('ex-early', 2)]] });

    await undo();

    expect(asked('PATCH')).toEqual(['/exchanges/ex-late/void']);
  });
});

describe('a protest is an entry the undo takes back', () => {
  /** A protest of the red Fighter that waits on the tablet, tapped at `minute`. */
  const protestWaits = (minute: number, sequence = minute) =>
    enqueue({
      kind: 'protest',
      clientUuid: uuid(minute),
      matchId: 'm1',
      sequence,
      registrationId: 'reg-red',
      cardedColor: 'red',
      occurredAt: at(minute),
    });

  it('undo takes a protest that is the newest entry, on the tablet and with PATCH /match-protests/:id/void', async () => {
    await waits(4);
    await protestWaits(6);
    // The server saved the protest and its answer was lost.
    const { asked } = server({ hits: [[held('ex-4', 4)]], protests: [held('pr-6', 6)] });

    await expect(undo()).resolves.toEqual(voided(6, 'pr-6'));

    expect(asked('GET')).toEqual(BOUT_READ);
    expect(asked('PATCH')).toEqual(['/match-protests/pr-6/void']);
    expect(await waiting()).toEqual([uuid(4)]);
  });

  it('undo voids a protest recorded by another tablet', async () => {
    const { asked } = server({ hits: [[held('ex-5', 5)]], protests: [held('pr-7', 7)] });

    await expect(undo()).resolves.toEqual(voided(7, 'pr-7'));

    expect(asked('PATCH')).toEqual(['/match-protests/pr-7/void']);
  });

  it('after a card given from the offer, the first undo takes the card and the second the protest', async () => {
    // Tapped in the same second: the card, given after the protest, has the next number.
    await protestWaits(5, 5);
    await enqueue({
      kind: 'penalty',
      clientUuid: uuid(55),
      matchId: 'm1',
      sequence: 6,
      registrationId: 'reg-red',
      directCard: 'yellow',
      occurredAt: at(5),
    });
    server({});

    await expect(undo()).resolves.toEqual(voided(55));
    expect(await waiting()).toEqual([uuid(5)]);
    await expect(undo()).resolves.toEqual(voided(5));
    expect(await waiting()).toEqual([]);
  });
});

describe('the newest entry waits on the tablet only', () => {
  it('goes from the tablet, the server is asked for it, and nothing is voided', async () => {
    await waits(6);
    const { asked } = server({ hits: [[held('ex-5', 5)]] });

    await expect(undo()).resolves.toEqual(voided(6));

    expect(await waiting()).toEqual([]);
    expect(asked('PATCH')).toEqual([]);
    expect(asked('GET')).toEqual([...BOUT_READ, ...BOUT_READ]);
    expect(await writtenDown()).toEqual([]);
  });

  it('a card goes the same way', async () => {
    await queueCard({ matchId: 'm1', sequence: 7, registrationId: 'reg-red', directCard: 'red' });
    server({ hits: [[held('ex-5', 5)]] });

    await expect(undo()).resolves.toMatchObject({ kind: 'voided' });
    expect(await waiting()).toEqual([]);
  });

  // The copy of a voided server entry is still the last line of the screen's list.
  it('a waiting copy of an entry the server holds VOIDED is the one taken back', async () => {
    await waits(5);
    const { asked } = server({ hits: [[held('ex-4', 4), held('ex-5', 5, { voided: true })]] });

    await expect(undo()).resolves.toEqual(voided(5));

    expect(await waiting()).toEqual([]);
    expect(asked('PATCH')).toEqual([]);
    expect(await writtenDown()).toEqual([]);
  });

  it('the server refuses the void of what it held: the refusal is said', async () => {
    await waits(6);
    server({
      hits: [[], [held('ex-6', 6)]],
      voids: () => json(409, { status: 409, detail: 'English', code: 'event_results_frozen' }),
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(undo()).resolves.toEqual({
      kind: 'failed',
      message: 'scoring.corrections.eventOver',
    });
  });

  it('the Event is over: the request filed for what the server held is said', async () => {
    await waits(6);
    server({ hits: [[], [held('ex-6', 6)]], voids: () => json(202, { pendingReview: true }) });

    await expect(undo()).resolves.toEqual({ kind: 'sent-for-review' });
  });

  it('reads the tablet at the tap: a hit pressed during the read is not the one undone', async () => {
    await waits(5);
    // The first read waits for `answer`; the reads after it are answered at once.
    const first: { answer?: (res: Response) => void } = {};
    const mayScore = () =>
      first.answer ? json(200, {}) : new Promise<Response>((resolve) => (first.answer = resolve));
    const { asked } = server({ mayScore });

    const undone = undo();
    await vi.waitFor(() => expect(asked('GET')).toHaveLength(1));
    await waits(9);
    first.answer?.(json(200, {}));
    await undone;

    expect(await waiting()).toEqual([uuid(9)]);
  });
});

describe('the server cannot be asked', () => {
  const offline = () => json(503, { error: 'offline', status: 503 });

  it('takes the tablet’s newest entry, writes it down, and asks ONE time only', async () => {
    await waits(4);
    await waits(6);
    const { asked } = server({ mayScore: offline });

    await expect(undo()).resolves.toEqual(voided(6));

    expect(await waiting()).toEqual([uuid(4)]);
    expect(await writtenDown()).toEqual([uuid(6)]);
    expect(asked('GET')).toEqual(['/matches/m1/penalty-ruleset']);
  });

  it('with nothing on the tablet says "online required"', async () => {
    server({ mayScore: offline });

    await expect(undo()).resolves.toEqual({
      kind: 'failed',
      message: 'scoring.corrections.onlineOnly',
    });
  });

  it('a caller who may not score: nothing is voided, no list is read', async () => {
    const { asked } = server({
      mayScore: () => json(403, { status: 403, detail: 'English', code: 'FORBIDDEN' }),
      hits: [[held('ex-5', 5)]],
    });

    await expect(undo()).resolves.toMatchObject({ kind: 'failed' });
    expect(asked('GET')).toEqual(['/matches/m1/penalty-ruleset']);
    expect(asked('PATCH')).toEqual([]);
  });
});

describe('a bout with nothing to undo', () => {
  it('nothing is asked of the tablet or voided, and nothing is said', async () => {
    const take = vi.fn();
    const { asked } = server({ hits: [[held('ex-1', 1, { voided: true })]] });

    await expect(undo(take)).resolves.toEqual({ kind: 'failed', message: null });

    expect(take).not.toHaveBeenCalled();
    expect(asked('PATCH')).toEqual([]);
  });
});

describe('the entry was on its way when the undo was tapped', () => {
  const landed = (serverId: string) => async (): Promise<TakenBack> => ({
    kind: 'landed',
    serverId,
  });

  it('landed under the server’s id: voided by that id, with no second read', async () => {
    await waits(6);
    const { asked } = server({});

    await expect(undo(landed('srv-6'))).resolves.toEqual(voided(6));

    expect(asked('PATCH')).toEqual(['/exchanges/srv-6/void']);
    expect(asked('GET')).toEqual(BOUT_READ);
  });

  // The answer carried no id: the store kept the entry's own uuid (a second try), or none.
  it.each([uuid(6), ''])('landed under no id (%j): found by the fresh read', async (serverId) => {
    await waits(6);
    const { asked } = server({ hits: [[], [held('ex-7', 7), held('ex-6', 6)]] });

    await expect(undo(landed(serverId))).resolves.toEqual(voided(6));

    expect(asked('PATCH')).toEqual(['/exchanges/ex-6/void']);
  });

  it('landed under no id, and the server does not list it: the screen reads again', async () => {
    await waits(6);
    const { asked } = server({});

    await expect(undo(landed(''))).resolves.toEqual({ kind: 'failed', message: null });
    expect(asked('PATCH')).toEqual([]);
  });
});

describe('newestToUndo and the screen’s list', () => {
  const serverRow = (minute: number, voided = false): ServerRow => ({
    kind: 'exchange',
    id: `ex-${minute}`,
    clientUuid: uuid(minute),
    voided,
    occurredAt: at(minute),
    sequence: minute,
  });

  // The undo takes back the line the scorekeeper sees last: both must drop the same copies.
  it('keeps the same waiting entries as the screen draws', async () => {
    for (const minute of [3, 4, 5]) await waits(minute);
    const entries = await getPendingForMatch('m1');
    const rows = [serverRow(3), serverRow(4, true)];
    const live = rows.filter((row) => !row.voided);

    const drawn = pendingRowsForMatch({
      entries,
      config: {} as never,
      scoringUnit: 'points',
      serverExchanges: live.map((row) => ({ client_uuid: row.clientUuid })) as never,
      serverPenalties: [],
      serverProtests: [],
    }).exchanges.map((row) => row.id);

    expect(drawn).toEqual([uuid(4), uuid(5)]);
    for (const shown of drawn) {
      const others = entries.filter((entry) => entry.clientUuid === shown);
      expect(newestToUndo(rows, others)).toMatchObject({ where: 'tablet' });
    }
    expect(newestToUndo(rows, entries.slice(0, 1))).toMatchObject({ where: 'server' });
  });

  it('with no answer of the server, the tablet’s newest entry', async () => {
    await waits(4);
    await waits(6);

    expect(newestToUndo(null, await getPendingForMatch('m1'))).toMatchObject({
      where: 'tablet',
      entry: { clientUuid: uuid(6) },
    });
  });
});

// Ruling 366. The settle writes down the undos it did not carry out, for the bout's screen.
// The answer about the entry he is undoing NOW goes to his button: the undo names it to the
// settle. What the settle does with that name is in `settle-undone.notices.test.ts`.
describe('the undo names the entry it takes off the tablet to the settle', () => {
  it('asks the settle for its own bout, with the id of that entry', async () => {
    await waits(5);
    server({ hits: [[]] });
    const settled = vi.spyOn(settle, 'settleUndone');

    await expect(undo()).resolves.toEqual(voided(5));

    expect(settled.mock.calls).toEqual([[API_URL, 'm1', uuid(5)]]);
  });
});
