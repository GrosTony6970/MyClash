/**
 * During the offline drill a press that goes straight to the server is
 * answered as a dead network is, and sends nothing (operator, 2026-10-12).
 *
 * The drill stopped the queue alone. A Reopen, a forfeit, a correction or the
 * void of an undo made during a drill reached the server for real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { createTranslator } from '@myclash/i18n/runtime';
import { messages } from '@myclash/i18n/staff';
import { undoLastEntry } from '../lib/clear-last';
import { refusalMessage } from '../lib/refusal-copy';
import { askVoid } from '../lib/void-entry';
import { db } from './db';
import { endOfflineDrill, startOfflineDrill } from './drill';
import { padRequest } from './drill-request';
import { SyncEngine, type SyncState } from './sync';
import {
  API_URL,
  addCard,
  addHit,
  addLevel,
  addPress,
  addRound,
  clearStore,
  heldRows,
  mockServer,
  queued,
} from './sync.press.fixtures';

const t = createTranslator(messages.en);

beforeEach(async () => {
  await clearStore();
  await Promise.all([db.undone.clear(), db.undoNotices.clear()]);
});
afterEach(endOfflineDrill);

describe('a press that goes straight to the server', () => {
  it('reaches the server with no drill', async () => {
    const fetched = vi.fn().mockResolvedValue(new Response('{"status":"halted"}', { status: 200 }));
    vi.stubGlobal('fetch', fetched);

    const result = await padRequest(API_URL, '/api/v1/matches/m1/clock', {
      method: 'POST',
      body: { action: 'reopen' },
    });

    expect(result).toEqual({ ok: true, data: { status: 'halted' } });
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it('is answered "no connection" during a drill, and sends nothing', async () => {
    const fetched = vi.fn();
    vi.stubGlobal('fetch', fetched);
    startOfflineDrill();

    const result = await padRequest(API_URL, '/api/v1/matches/m1/forfeit', {
      method: 'POST',
      body: {},
    });

    expect(fetched).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, kind: 'http', status: 503, code: null });
    if (result.ok) throw new Error('unreachable');
    expect(refusalMessage(result, t, 'scoring.corrections.actionFailed')).toBe(
      t('scoring.corrections.offlineRefusal'),
    );
  });

  it('the void of an undo sends nothing during a drill', async () => {
    const fetched = vi.fn();
    vi.stubGlobal('fetch', fetched);
    startOfflineDrill();

    const result = await askVoid(API_URL, { kind: 'exchange', id: 'x1' });

    expect(fetched).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, status: 503 });
  });
});

describe('the queue during a drill', () => {
  it('sends no row of any of the five kinds, holds none, and says offline', async () => {
    await addPress('start');
    await addHit();
    await addCard();
    await addRound('end', 1);
    await addLevel();
    const server = mockServer();
    startOfflineDrill();
    const engine = new SyncEngine(API_URL);
    const states: SyncState[] = [];
    engine.subscribe((state) => states.push(state));

    await engine.drain();

    expect(server.calls).toEqual([]);
    expect(await heldRows()).toEqual([]);
    expect(await queued()).toHaveLength(5);
    expect(states.at(-1)).toMatchObject({ status: 'offline', pendingCount: 5, rejectedCount: 0 });
  });

  it('goes to the server, in its order, once the drill has ended', async () => {
    await addPress('start');
    await addHit();
    const server = mockServer();
    startOfflineDrill();
    const engine = new SyncEngine(API_URL);
    await engine.drain();

    endOfflineDrill();
    await engine.drain();

    expect(server.calls).toEqual(['clock m1 start', 'exchanges m1']);
    expect(await queued()).toEqual([]);
  });
});

describe('the words of the drill', () => {
  it.each([
    ['en', messages.en, 'Entries are queued', 'extra-time presses', 'no entry of a match'],
    ['fr', messages.fr, 'Les saisies sont en file', 'la prolongation', 'aucune saisie de match'],
  ] as const)('name every entry, in %s', (_language, tree, banner, levelStep, scope) => {
    const say = createTranslator(tree);
    expect(say('scoring.drill.banner', { seconds: '90' })).toContain(banner);
    expect(say('scoring.drill.banner', { seconds: '90' })).toContain('90');
    // Five kinds of entry wait in a drill; the step of a level bout was the one left out.
    expect(say('scoring.drill.explain')).toContain(levelStep);
    // Not "sends nothing": the reads and the heartbeat still go.
    expect(say('scoring.drill.explain')).toContain(scope);
  });
});

describe('the undo during a drill', () => {
  it('takes the hit off the tablet and asks the server nothing', async () => {
    await addHit('m1', 'uuid-drill');
    const server = mockServer();
    const fetched = vi.mocked(fetch);
    startOfflineDrill();
    const engine = new SyncEngine(API_URL);

    const outcome = await undoLastEntry({
      apiUrl: API_URL,
      matchId: 'm1',
      t,
      takeBack: (entry) => engine.takeBack(entry),
    });

    expect(outcome).toEqual({ kind: 'voided', entry: { clientUuid: 'uuid-drill' } });
    expect(await queued()).toEqual([]);
    expect(server.calls).toEqual([]);
    expect(fetched, 'not even the read of the server').not.toHaveBeenCalled();
    expect((await db.undone.toArray()).map((row) => row.clientUuid)).toEqual(['uuid-drill']);
  });
});
