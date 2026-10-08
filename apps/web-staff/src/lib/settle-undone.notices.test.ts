import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';

import { db } from '../offline/db';
import { noticesOf, saidNotices } from '../offline/undo-notices';
import { settleUndone } from './settle-undone';

/**
 * An undo the tablet wrote down and did not carry out is written down for the screen of its
 * bout (rulings 364 to 366).
 *
 * Marc undoes hit 5 on bout A with no wifi, then opens bout B. The wifi returns and the server
 * refuses the undo. Only the console knew, and hit 5 came back on bout A with no word. The
 * settle now writes what it did not carry out, with its bout: a refusal, an undo let go after
 * a day, and an undo of a bout that ended meanwhile, which the tablet no longer sends.
 */
const API_URL = 'http://localhost:4000';

beforeEach(async () => {
  await db.undone.clear();
  await db.undoNotices.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });
const refusal = (status: number, code: string) => json(status, { status, detail: 'English', code });
const hit = (id: string, clientUuid: string) => ({
  id,
  client_uuid: clientUuid,
  voided: false,
  sequence: 1,
  occurred_at: '2026-10-06T10:01:00.000Z',
});

/** A server that holds `hits` for every bout, each bout in the status `bouts` gives it. */
function server(
  hits: unknown[],
  bouts: Record<string, () => Response> = {},
  voids?: () => Response,
) {
  const calls: Array<[string, string]> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string }) => {
      const path = url.replace(`${API_URL}/api/v1`, '');
      calls.push([init?.method ?? 'GET', path]);
      if (init?.method === 'PATCH') return (voids ?? (() => json(200, { voided: true })))();
      if (path.endsWith('/penalty-ruleset')) return json(200, {});
      if (path.endsWith('/exchanges')) return json(200, hits);
      if (path.endsWith('/penalties')) return json(200, []);
      const bout = bouts[path.replace('/matches/', '')];
      return bout ? bout() : json(200, { status: 'running' });
    }),
  );
  const asked = (method: string) => calls.filter(([verb]) => verb === method).map(([, at]) => at);
  return { asked };
}

const HOUR = 60 * 60 * 1000;
const wroteDown = (clientUuid: string, matchId = 'bout-a', hoursAgo = 0) =>
  db.undone.put({ clientUuid, matchId, undoneAt: Date.now() - hoursAgo * HOUR });
const stillWritten = async () => (await db.undone.toArray()).map((entry) => entry.clientUuid);
const said = async (matchId: string) =>
  (await noticesOf(matchId)).map(({ clientUuid, why, refusal: refused }) => [
    clientUuid,
    why,
    refused && 'code' in refused ? refused.code : null,
  ]);
const completed = () => json(200, { status: 'completed' });

describe('a refused undo is written down for the screen of its bout (ruling 364)', () => {
  it('keeps each refusal with its bout, and with the server’s code', async () => {
    await wroteDown('uuid-5', 'bout-a');
    await wroteDown('uuid-6', 'bout-a');
    await wroteDown('uuid-9', 'bout-b');
    server([hit('ex-5', 'uuid-5'), hit('ex-6', 'uuid-6'), hit('ex-9', 'uuid-9')], {}, () =>
      refusal(400, 'match_locked'),
    );

    await settleUndone(API_URL);

    expect(await said('bout-a')).toEqual([
      ['uuid-5', 'refused', 'match_locked'],
      ['uuid-6', 'refused', 'match_locked'],
    ]);
    expect(await said('bout-b')).toEqual([['uuid-9', 'refused', 'match_locked']]);
    expect(await stillWritten()).toEqual([]);
  });

  it.each([
    ['is voided', () => json(200, { voided: true })],
    ['is sent for review', () => json(202, { pendingReview: true })],
    ['is kept: the server gave no verdict', () => refusal(500, 'INTERNAL')],
  ])('writes nothing for an undo that %s', async (_what, voids) => {
    await wroteDown('uuid-5');
    server([hit('ex-5', 'uuid-5')], {}, voids);

    await settleUndone(API_URL);

    expect(await said('bout-a')).toEqual([]);
  });

  it('writes nothing for an entry the server does not hold', async () => {
    await wroteDown('uuid-5');
    server([]);

    await settleUndone(API_URL);

    expect(await said('bout-a')).toEqual([]);
  });

  // The undo he is tapping now is answered at his button: said twice, it reads as two.
  it('writes nothing for the undo being tapped now, and still forgets it', async () => {
    await wroteDown('uuid-5');
    server([hit('ex-5', 'uuid-5')], {}, () => refusal(400, 'match_locked'));

    const settled = await settleUndone(API_URL, 'bout-a', 'uuid-5');

    expect(settled.get('uuid-5')).toMatchObject({ refused: { code: 'match_locked' } });
    expect(await said('bout-a')).toEqual([]);
    expect(await stillWritten()).toEqual([]);
  });

  it('is removed once the screen said it, and only the rows it showed', async () => {
    await wroteDown('uuid-5');
    await wroteDown('uuid-6');
    server([hit('ex-5', 'uuid-5'), hit('ex-6', 'uuid-6')], {}, () => refusal(400, 'match_locked'));
    await settleUndone(API_URL);
    const [first] = await noticesOf('bout-a');

    await saidNotices([first!]);

    expect(await said('bout-a')).toEqual([['uuid-6', 'refused', 'match_locked']]);
  });
});

describe('an undo let go after a day is written down too (ruling 365)', () => {
  it('says so on its bout’s screen, and asks the server nothing for it', async () => {
    await wroteDown('uuid-old', 'bout-a', 25);
    const { asked } = server([hit('ex-old', 'uuid-old')]);

    expect(await settleUndone(API_URL)).toEqual(new Map([['uuid-old', 'expired']]));

    expect(await said('bout-a')).toEqual([['uuid-old', 'expired', null]]);
    expect(asked('GET')).toEqual([]);
    expect(await stillWritten()).toEqual([]);
  });
});

describe('the tablet corrects no finished bout by itself (ruling 366)', () => {
  it('does not void an undo it remembered when the bout is completed, and says so', async () => {
    await wroteDown('uuid-5');
    const { asked } = server([hit('ex-5', 'uuid-5')], { 'bout-a': completed });

    expect(await settleUndone(API_URL)).toEqual(new Map([['uuid-5', 'ended']]));

    expect(asked('PATCH')).toEqual([]);
    expect(await said('bout-a')).toEqual([['uuid-5', 'ended', null]]);
    expect(await stillWritten()).toEqual([]);
  });

  it.each(['running', 'paused', 'scheduled', 'voided'])(
    'still voids it when the bout is %s',
    async (status) => {
      await wroteDown('uuid-5');
      const { asked } = server([hit('ex-5', 'uuid-5')], { 'bout-a': () => json(200, { status }) });

      expect(await settleUndone(API_URL)).toEqual(new Map([['uuid-5', 'voided']]));
      expect(asked('PATCH')).toEqual(['/exchanges/ex-5/void']);
    },
  );

  // Not known is not "running": the entry is kept, and asked again at the next run.
  it.each([
    ['a server fault', () => refusal(500, 'INTERNAL')],
    ['a throttle', () => refusal(429, 'too_many_requests')],
  ])('keeps the undo, and voids nothing, when the bout’s read meets %s', async (_what, bout) => {
    await wroteDown('uuid-5');
    const { asked } = server([hit('ex-5', 'uuid-5')], { 'bout-a': bout });

    expect(await settleUndone(API_URL)).toEqual(new Map([['uuid-5', 'kept']]));

    expect(asked('PATCH')).toEqual([]);
    expect(await said('bout-a')).toEqual([]);
    expect(await stillWritten()).toEqual(['uuid-5']);
  });

  it('reads the bout once for several undos, and only when the server holds one', async () => {
    await wroteDown('uuid-5');
    await wroteDown('uuid-6');
    await wroteDown('uuid-9', 'bout-b');
    const { asked } = server([hit('ex-5', 'uuid-5'), hit('ex-6', 'uuid-6')], {
      'bout-a': completed,
    });

    await settleUndone(API_URL);

    const boutReads = asked('GET').filter((path) => /^\/matches\/[^/]+$/.test(path));
    expect(boutReads).toEqual(['/matches/bout-a']);
    expect(await said('bout-a')).toEqual([
      ['uuid-5', 'ended', null],
      ['uuid-6', 'ended', null],
    ]);
  });

  // He is watching: the undo he taps on a finished bout is his correction, sent as before.
  it('still sends the undo being tapped now on a completed bout, and asks no status', async () => {
    await wroteDown('uuid-5');
    const { asked } = server([hit('ex-5', 'uuid-5')], { 'bout-a': completed });

    const settled = await settleUndone(API_URL, 'bout-a', 'uuid-5');

    expect(settled).toEqual(new Map([['uuid-5', 'voided']]));
    expect(asked('PATCH')).toEqual(['/exchanges/ex-5/void']);
    expect(asked('GET')).not.toContain('/matches/bout-a');
  });

  it('lets go the one he remembered while it sends the one he taps, on the same bout', async () => {
    await wroteDown('uuid-4');
    await wroteDown('uuid-5');
    const { asked } = server([hit('ex-4', 'uuid-4'), hit('ex-5', 'uuid-5')], {
      'bout-a': completed,
    });

    const settled = await settleUndone(API_URL, 'bout-a', 'uuid-5');

    expect(settled).toEqual(
      new Map([
        ['uuid-4', 'ended'],
        ['uuid-5', 'voided'],
      ]),
    );
    expect(asked('PATCH')).toEqual(['/exchanges/ex-5/void']);
  });
});
