/**
 * A team's card and a team's protest go through the pad's queue as a
 * Fighter's do (call 9). The row names the team (`teamId`) and no
 * Registration; the send names exactly that one field (call 8: the server's
 * door refuses both or neither); a refused one is held in the inbox with its
 * team, never deleted.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { getAllPending, getRejected, queueCard, requeueRejected } from './outbox';
import { queueProtest } from './protest-queue';
import { SyncEngine } from './sync';

const API_URL = 'http://localhost:4000';
const BOUT = { label: 'LSW-P1-M3', red: 'Lyon Blades', blue: 'Rennes Rapières' };
const TEAM = '7a1e5c3b-2d4f-4a6b-8c9d-0e1f2a3b4c5d';
const TEAM_SIDE = { kind: 'team', id: TEAM } as const;

const CARD = {
  matchId: 'm1',
  sequence: 4,
  side: TEAM_SIDE,
  clockTimeMs: 61_000,
  round: 1,
  bout: BOUT,
  cardedColor: 'red',
  directCard: 'yellow',
  reason: 'Left the piste',
} as const;

const PROTEST = {
  matchId: 'm1',
  sequence: 5,
  side: TEAM_SIDE,
  clockTimeMs: 62_000,
  round: 1,
  bout: BOUT,
  cardedColor: 'red',
} as const;

beforeEach(async () => {
  await db.outbox.clear();
  await db.synced.clear();
  await db.rejected.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The server: every POST answered by `post`; a GET answers an empty list. The POST bodies. */
function mockApi(post: () => Response): Array<{ path: string; body: Record<string, unknown> }> {
  const sent: Array<{ path: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if ((init?.method ?? 'GET') === 'GET') return Promise.resolve(Response.json([]));
      const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      sent.push({ path: url.replace(`${API_URL}/api/v1`, ''), body });
      return Promise.resolve(post());
    }),
  );
  return sent;
}

const refused = () =>
  Response.json({ message: 'teamId is not a side of this match' }, { status: 400 });

describe("a team's card on the pad", () => {
  it('is one row of the queue that names the team and no Registration', async () => {
    await queueCard(CARD);

    const [row] = await getAllPending();
    expect(row).toMatchObject({ kind: 'penalty', teamId: TEAM, directCard: 'yellow' });
    expect(row).not.toHaveProperty('registrationId');
    expect(row).not.toHaveProperty('side');
  });

  it('drains to POST /matches/:id/penalties with teamId and no registrationId', async () => {
    const sent = mockApi(() => Response.json({ id: 'card-1' }, { status: 201 }));
    await queueCard(CARD);

    await new SyncEngine(API_URL).drain();

    expect(sent.map((call) => call.path)).toEqual(['/matches/m1/penalties']);
    expect(Object.keys(sent[0]!.body).sort()).toEqual(
      [
        'clientUuid',
        'clockTimeMs',
        'directCard',
        'occurredAt',
        'reason',
        'sentAt',
        'sequence',
        'teamId',
      ].sort(),
    );
    expect(sent[0]!.body).toMatchObject({ teamId: TEAM, directCard: 'yellow' });
    expect(await getAllPending()).toEqual([]);
  });

  it('refused with a 400, it is held in the inbox with its team, and a Retry sends the team again', async () => {
    const sent = mockApi(refused);
    await queueCard(CARD);

    await new SyncEngine(API_URL).drain();

    expect(await getAllPending()).toEqual([]);
    const held = await getRejected();
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({
      kind: 'penalty',
      teamId: TEAM,
      rejectedReason: 'teamId is not a side of this match',
    });
    expect(held[0]).not.toHaveProperty('registrationId');
    expect(sent.every((call) => call.body['teamId'] === TEAM)).toBe(true);

    await requeueRejected();
    const [back] = await getAllPending();
    expect(back).toMatchObject({ kind: 'penalty', teamId: TEAM });
    expect(back).not.toHaveProperty('registrationId');
  });
});

describe("a team's protest on the pad", () => {
  it('drains to POST /matches/:id/protests with teamId and no registrationId', async () => {
    const sent = mockApi(() => Response.json({ id: 'protest-1' }, { status: 201 }));
    await queueProtest(PROTEST);
    const [row] = await getAllPending();
    expect(row).toMatchObject({ kind: 'protest', teamId: TEAM });
    expect(row).not.toHaveProperty('registrationId');

    await new SyncEngine(API_URL).drain();

    expect(sent.map((call) => call.path)).toEqual(['/matches/m1/protests']);
    expect(Object.keys(sent[0]!.body).sort()).toEqual(
      ['clientUuid', 'clockTimeMs', 'occurredAt', 'sentAt', 'sequence', 'teamId'].sort(),
    );
    expect(sent[0]!.body['teamId']).toBe(TEAM);
  });

  it('refused with a 400, it is held in the inbox with its team', async () => {
    mockApi(refused);
    await queueProtest(PROTEST);

    await new SyncEngine(API_URL).drain();

    const held = await getRejected();
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ kind: 'protest', teamId: TEAM });
    expect(held[0]).not.toHaveProperty('registrationId');
  });
});
