/**
 * A hit or a card queued while the pad sends goes in the same send.
 *
 * A send walks the list it read at its start, and a send asked for while one
 * ran answered at once and did nothing. So a card given while a hit was on its
 * way stayed on the tablet until the next hit, Retry or connection event, and
 * the send that ran ended on "could not be synced" though nothing had failed.
 * A send asked for while one runs now means one more pass. Its press does not
 * wait for it (ruling 316): the buttons come back at once, and the bout screen
 * reads the server again when the engine says the send has ended.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { offlineResponse } from './failure-kind';
import { enqueue, getAllPending, getRejected, quarantine, queueCard } from './outbox';
import { SyncEngine, type SyncState } from './sync';

const API_URL = 'http://localhost:4000';
const SAVED = { status: 201, body: { id: 'srv' } };

beforeEach(async () => {
  await db.outbox.clear();
  await db.synced.clear();
  await db.rejected.clear();
  vi.restoreAllMocks();
});

type Answer = { status: number; body: unknown };

/** Every POST waits for `answer`; `posted` names each one sent, in order. */
function heldApi() {
  const posted: string[] = [];
  const waiting: Array<(res: unknown) => void> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((_url: string, init?: { body?: string }) => {
      posted.push((JSON.parse(init?.body ?? '{}') as { clientUuid: string }).clientUuid);
      return new Promise((resolve) => waiting.push(resolve));
    }),
  );
  const answer = async ({ status, body }: Answer) => {
    await vi.waitFor(() => expect(waiting.length).toBeGreaterThan(0));
    waiting.shift()?.({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });
  };
  return { posted, answer };
}

function addHit(sequence: number, clientUuid: string) {
  return enqueue({
    clientUuid,
    matchId: 'm1',
    sequence,
    type: 'clean',
    occurredAt: new Date().toISOString(),
    firstStrikerColor: 'red',
    firstStrikeValue: 1,
  });
}

/** An engine whose send of the hit `uuid-1` waits on the server, `behind` more hits after it. */
async function sending(behind = 0) {
  const api = heldApi();
  await addHit(1, 'uuid-1');
  for (let i = 2; i < behind + 2; i += 1) await addHit(i, `uuid-${i}`);
  const engine = new SyncEngine(API_URL);
  const states: SyncState[] = [];
  engine.subscribe((state) => states.push(state));
  const first = engine.drain();
  await vi.waitFor(() => expect(api.posted).toEqual(['uuid-1']));
  return { ...api, engine, states, first };
}

describe('a card given while a hit is on its way', () => {
  it('goes in the same send, after the hit, and the bar never says "could not be synced"', async () => {
    const { engine, states, first, posted, answer } = await sending();

    await queueCard({ matchId: 'm1', sequence: 2, registrationId: 'reg-red', directCard: 'red' });
    const second = engine.drain();
    await answer(SAVED);
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    await answer(SAVED);
    await Promise.all([first, second]);

    expect(posted[0]).toBe('uuid-1');
    expect(await getAllPending()).toHaveLength(0);
    expect(await db.synced.count()).toBe(2);
    expect(states.map((state) => state.status)).not.toContain('error');
    expect(states.at(-1)).toMatchObject({ status: 'idle', pendingCount: 0 });
  });

  it('a press waits for nothing: the send goes on behind (ruling 316)', async () => {
    const { engine, first, posted, answer } = await sending();
    await addHit(2, 'uuid-2');

    expect(engine.sendBehind()).toBeUndefined();

    expect(posted, 'the first hit is still waiting for its answer').toEqual(['uuid-1']);
    expect(engine.isDraining()).toBe(true);
    await answer(SAVED);
    await answer(SAVED);
    await first;
    expect(posted).toEqual(['uuid-1', 'uuid-2']);
    expect(engine.isDraining()).toBe(false);
  });

  it('a caller that does wait is answered once its own hit is: the inbox reads its list then', async () => {
    const { engine, posted, answer } = await sending();
    await addHit(2, 'uuid-2');
    let answered = false;
    const second = engine.drain().then(() => {
      answered = true;
    });

    await answer(SAVED);
    await vi.waitFor(() => expect(posted).toEqual(['uuid-1', 'uuid-2']));

    expect(answered).toBe(false);
    await answer(SAVED);
    await second;
  });

  it('sends nothing twice when the send in flight already took it', async () => {
    const { engine, first, posted, answer } = await sending(1);

    const second = engine.drain();
    await answer(SAVED);
    await answer(SAVED);
    await Promise.all([first, second]);

    expect(posted).toEqual(['uuid-1', 'uuid-2']);
  });
});

describe('a send that stops', () => {
  it('for who sends it leaves the new hit waiting behind the first, and asks nothing more', async () => {
    const { engine, states, first, posted, answer } = await sending();
    await addHit(2, 'uuid-2');
    const second = engine.drain();

    await answer({ status: 403, body: { message: 'in English', code: 'account_cannot_score' } });
    await Promise.all([first, second]);

    expect(posted, 'the hit behind meets the same answer').toEqual(['uuid-1']);
    expect(states.at(-1)).toMatchObject({ status: 'account-refused', pendingCount: 2 });
    expect(engine.isDraining()).toBe(false);
  });

  it('for a dead network leaves the new hit waiting too', async () => {
    const offline = offlineResponse();
    const down = { status: offline.status, body: await offline.json() };
    const { engine, states, first, posted, answer } = await sending(2);

    await addHit(4, 'uuid-4');
    const second = engine.drain();
    await answer(down);
    await answer(down);
    await answer(down);
    await Promise.all([first, second]);

    expect(posted).toEqual(['uuid-1', 'uuid-2', 'uuid-3']);
    expect(states.at(-1)).toMatchObject({ status: 'offline', pendingCount: 4 });
  });

  it('is asked again by the next press, which sends the queue in order', async () => {
    const { engine, first, posted, answer } = await sending();
    await addHit(2, 'uuid-2');
    const second = engine.drain();
    await answer({ status: 403, body: { code: 'account_cannot_score' } });
    await Promise.all([first, second]);

    const third = engine.drain();
    await answer(SAVED);
    await answer(SAVED);
    await third;

    expect(posted).toEqual(['uuid-1', 'uuid-1', 'uuid-2']);
    expect(await getAllPending()).toHaveLength(0);
  });
});

describe('the other ways a send is asked for while one runs', () => {
  it('Retry of a held hit sends it after the hit in flight', async () => {
    await quarantine(await addHit(7, 'uuid-held'), 'Match is locked');
    const heldId = (await getRejected())[0]!.id as number;
    const { engine, first, posted, answer } = await sending();

    const retried = engine.retryRejectedEntry(heldId);
    await answer(SAVED);
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    await answer(SAVED);
    await Promise.all([first, retried]);

    expect(posted).toEqual(['uuid-1', 'uuid-held']);
    expect(await getRejected()).toHaveLength(0);
  });
});

describe('the end of a send is told (ruling 316)', () => {
  // No press waits for a send that runs behind: the screen reads the server again when told.
  it('once, after the last pass, when the server has every hit', async () => {
    const { engine, first, posted, answer } = await sending();
    const synced: number[] = [];
    engine.onSendEnded(() => void db.synced.count().then((count) => synced.push(count)));
    let told = 0;
    engine.onSendEnded(() => {
      told += 1;
      expect(engine.isDraining()).toBe(false);
    });

    await addHit(2, 'uuid-2');
    engine.sendBehind();
    await answer(SAVED);
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    expect(told, 'not between two passes').toBe(0);
    await answer(SAVED);
    await first;

    expect(told).toBe(1);
    await vi.waitFor(() => expect(synced).toEqual([2]));
  });

  it('when the send stopped: the tablet still holds the hits the screen shows', async () => {
    const { engine, first, answer } = await sending();
    const ended = vi.fn();
    engine.onSendEnded(ended);

    await answer({ status: 403, body: { code: 'account_cannot_score' } });
    await first;

    expect(ended).toHaveBeenCalledOnce();
  });

  it('not for a send that found nothing to send: a screen that opens reads once', async () => {
    heldApi();
    const engine = new SyncEngine(API_URL);
    const ended = vi.fn();
    engine.onSendEnded(ended);

    await engine.drain();

    expect(ended).not.toHaveBeenCalled();
  });

  it('when the send threw: hits may have gone before the throw, and the throw is logged', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const api = heldApi();
    await addHit(1, 'uuid-1');
    const engine = new SyncEngine(API_URL);
    engine.subscribe(() => {
      throw new Error('a listener broke');
    });
    const ended = vi.fn();
    engine.onSendEnded(ended);

    engine.sendBehind();

    await vi.waitFor(() => expect(ended).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(logged).toHaveBeenCalledOnce());
    expect(String(logged.mock.calls[0]?.[1])).toContain('a listener broke');
    expect(api.posted, 'it threw before the first hit left').toEqual([]);
  });

  it('to every screen, and the send stands, when one of them throws', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { engine, first, answer } = await sending();
    engine.onSendEnded(() => {
      throw new Error('a screen broke');
    });
    const ended = vi.fn();
    engine.onSendEnded(ended);

    await answer(SAVED);
    await expect(first).resolves.toBeUndefined();

    expect(ended).toHaveBeenCalledOnce();
    expect(logged).toHaveBeenCalledOnce();
  });

  it('no longer to a screen that left', async () => {
    const { engine, first, answer } = await sending();
    const ended = vi.fn();
    engine.onSendEnded(ended)();

    await answer(SAVED);
    await first;

    expect(ended).not.toHaveBeenCalled();
  });
});

describe('the bout screen', () => {
  // web-staff has no React test setup: the screens are read as text.
  const read = (...path: string[]) => readFileSync(join(__dirname, '..', ...path), 'utf8');

  it('reads its lists and the bout again when a send has ended, and moves no sequence', () => {
    const view = read('components', 'MatchView.tsx');
    expect(view).toContain(
      'const readListsAgain = useCallback(() => setRefreshKey((k) => k + 1), []);',
    );
    expect(view).toContain('useSendEnded(syncEngine, readListsAgain);');
    const page = read('..', 'app', 'matches', '[matchId]', 'page.tsx');
    expect(page).toContain(
      'const readBoutAgain = useCallback(() => setRefreshKey((key) => key + 1), []);',
    );
    // Above the effect that starts the first send: no send ends unheard.
    expect(page.indexOf('useSendEnded(syncEngine, readBoutAgain);')).toBeGreaterThan(0);
    expect(page.indexOf('useSendEnded(syncEngine, readBoutAgain);')).toBeLessThan(
      page.indexOf('void syncEngine.drain();'),
    );
    expect(read('offline', 'use-sync-state.ts')).toContain(
      'useEffect(() => engine?.onSendEnded(ended), [engine, ended]);',
    );
  });

  it('no press waits for the send: a hit, a list card and a direct card ask and go on', () => {
    for (const file of [
      ['hooks', 'useScoringSubmit.ts'],
      ['components', 'ScoringColumn.tsx'],
      ['components', 'DirectCardPanel.tsx'],
    ]) {
      const source = read(...file);
      expect(source, file[1]).toContain('syncEngine?.sendBehind()');
      expect(source, file[1]).not.toMatch(/\.drain\(\)/);
    }
  });

  it('a read of the bout that lands after a later one is dropped', () => {
    const page = read('..', 'app', 'matches', '[matchId]', 'page.tsx');
    expect(page.match(/if \(stale\) return;/g)).toHaveLength(2);
    expect(page).toMatch(
      /return \(\) => \{\s+stale = true;\s+\};\s+\}, \[matchId, apiUrl, refreshKey\]\);/,
    );
  });
});

describe('a send that throws', () => {
  it('leaves the pad able to send again', async () => {
    const api = heldApi();
    await addHit(1, 'uuid-1');
    const engine = new SyncEngine(API_URL);
    const leave = engine.subscribe(() => {
      throw new Error('a listener broke');
    });

    await expect(engine.drain()).rejects.toThrow('a listener broke');
    leave();
    expect(engine.isDraining()).toBe(false);

    const again = engine.drain();
    await api.answer(SAVED);
    await again;
    expect(api.posted).toEqual(['uuid-1']);
  });
});
