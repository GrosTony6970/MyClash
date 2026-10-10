/**
 * A queued hit the server answers with 401 WAITS, and the pad says why (ruling 241).
 *
 * A 401 is nobody signed in: a PIN session ends with its Event's last day, and
 * no PIN can sign in on an Event that is over. The drain used to count it as a
 * failed attempt like a 500, so the bar said "sync error" over a tablet that
 * was simply signed out. The hit is not refused: it stays in the queue, in
 * order, and the pad sends nothing more until somebody signs in.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { enqueue, quarantine } from './outbox';
import { SyncEngine, type SyncState } from './sync';
import { needsOperator, syncBarLabel, syncBarTone, syncPhaseOf } from '../lib/sync-bar';
import { unsentHitsMessage } from '../lib/unsent-hits';

const API_URL = 'http://localhost:4000';
const NO_SESSION = { message: 'Staff session required' };

beforeEach(async () => {
  await db.outbox.clear();
  await db.synced.clear();
  await db.rejected.clear();
  vi.restoreAllMocks();
});

/** Answers each POST from the sequence it carried; a GET lists no row. */
function mockApi(post: (sequence: number) => { status: number; body: unknown }) {
  const posted: number[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((_url: string, init?: { method?: string; body?: string }) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      const sequence = (JSON.parse(init?.body ?? '{}') as { sequence: number }).sequence;
      posted.push(sequence);
      const r = post(sequence);
      return Promise.resolve({
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: () => Promise.resolve(r.body),
      });
    }),
  );
  return { posted };
}

function addHit(sequence: number, clientUuid: string, matchId = 'm1') {
  return enqueue({
    clientUuid,
    matchId,
    sequence,
    type: 'clean',
    occurredAt: new Date().toISOString(),
    firstStrikerColor: 'red',
    firstStrikeValue: 1,
  });
}

async function drainWatched(engine: SyncEngine): Promise<SyncState | undefined> {
  const states: SyncState[] = [];
  const stop = engine.subscribe((state) => states.push(state));
  await engine.drain();
  stop();
  return states.at(-1);
}

describe('drain — nobody is signed in (401)', () => {
  it('keeps every hit waiting, in order, and says the session has ended', async () => {
    await addHit(1, 'uuid-1');
    await addHit(2, 'uuid-2');
    await addHit(3, 'uuid-3');
    mockApi(() => ({ status: 401, body: NO_SESSION }));

    const last = await drainWatched(new SyncEngine(API_URL));

    expect(last).toMatchObject({ status: 'signed-out', pendingCount: 3, rejectedCount: 0 });
    expect((await db.outbox.orderBy('id').toArray()).map((row) => row.clientUuid)).toEqual([
      'uuid-1',
      'uuid-2',
      'uuid-3',
    ]);
    expect(await db.rejected.count(), 'a waiting hit is not a refused one').toBe(0);
    expect((await db.outbox.toArray()).map((row) => row.attempts)).toEqual([0, 0, 0]);
    expect(await db.synced.count()).toBe(0);
  });

  it('stops at the first one: the hits behind it meet the same answer', async () => {
    // A 401 is about the caller, never about one hit.
    await addHit(1, 'uuid-1');
    await addHit(2, 'uuid-2');
    await addHit(3, 'uuid-3');
    const { posted } = mockApi(() => ({ status: 401, body: NO_SESSION }));

    await new SyncEngine(API_URL).drain();

    expect(posted).toEqual([1]);
  });

  it('sends the same queue, in order, once somebody is signed in', async () => {
    await addHit(1, 'uuid-1');
    await addHit(2, 'uuid-2');
    let signedIn = false;
    const { posted } = mockApi((sequence) =>
      signedIn
        ? { status: 201, body: { id: `srv-${sequence}` } }
        : { status: 401, body: NO_SESSION },
    );
    const engine = new SyncEngine(API_URL);
    await engine.drain();

    signedIn = true;
    const last = await drainWatched(engine);

    expect(posted).toEqual([1, 1, 2]);
    expect((await db.synced.toArray()).map((row) => row.clientUuid)).toEqual(['uuid-1', 'uuid-2']);
    expect(last).toMatchObject({ status: 'idle', pendingCount: 0 });
  });

  it('is said over a held hit too: "refused" would hide why nothing goes', async () => {
    await quarantine(await addHit(1, 'uuid-held'), 'Match is locked');
    await addHit(2, 'uuid-waiting', 'm2');
    mockApi(() => ({ status: 401, body: NO_SESSION }));

    const last = await drainWatched(new SyncEngine(API_URL));

    expect(last).toMatchObject({ status: 'signed-out', pendingCount: 1, rejectedCount: 1 });
  });
});

describe('the bout screen', () => {
  // web-staff has no React test setup: the screen is read as text.
  const page = readFileSync(
    join(__dirname, '..', '..', 'app', 'matches', '[matchId]', 'page.tsx'),
    'utf8',
  );
  const bar = readFileSync(join(__dirname, '..', 'components', 'SyncBar.tsx'), 'utf8');

  const t = (key: string) => key;

  it('says the session has ended, not "sync error", in red and with Retry', () => {
    const phase = syncPhaseOf('online', 'signed-out');
    expect(syncBarLabel(phase, 0, t, 1, 0)).toBe('⚠ scoring.lice.sessionEnded');
    expect(syncBarLabel(phase, 2, t, 1, 0), 'a held hit does not reword it').toBe(
      '⚠ scoring.lice.sessionEnded',
    );
    expect(syncBarTone(phase)).toBe(syncBarTone('error'));
    expect(needsOperator(phase)).toBe(true);
  });

  it('keeps the four older states', () => {
    expect(syncPhaseOf('offline', 'signed-out'), 'browser-offline wins').toBe('offline');
    expect(syncPhaseOf('online', undefined)).toBe('online');
    expect(syncPhaseOf('online', 'idle')).toBe('online');
    expect(syncBarLabel('online', 0, t, 0, 0)).toBe('● scoring.lice.online');
    expect(syncBarLabel('syncing', 0, t, 1, 0)).toBe('⟳ scoring.lice.syncing');
    expect(syncBarLabel('offline', 0, t, 1, 0)).toBe('● scoring.lice.offlineQueued');
    expect(syncBarLabel('error', 0, t, 1, 0)).toBe('⚠ scoring.lice.syncError');
    expect(syncBarLabel('error', 1, t, 0, 0)).toBe('⚠ scoring.lice.hitsRefused');
    expect(needsOperator('offline')).toBe(false);
    expect(syncBarTone('offline')).not.toBe(syncBarTone('error'));
  });

  it('draws the bar from those decisions', () => {
    expect(bar).toContain('syncPhaseOf(networkStatus, syncState?.status)');
    expect(bar).toContain(
      '{syncBarLabel(phase, rejected, t, pending, syncState?.heldPressCount ?? 0)}',
    );
    expect(bar).toContain('${syncBarTone(phase)}');
    expect(bar).toContain('{offersRetry(phase, { rejected, sendable, pending }) && (');
  });

  it('Retry leaves a held hit held while signed out', () => {
    expect(bar).toMatch(
      /sendable > 0 && phase === 'error' \? syncEngine\.retryRejected\(\) : syncEngine\.drain\(\)/,
    );
  });

  it('sends what the tablet holds when the screen opens', () => {
    // A tablet opened again while online gets no `online` event: without this
    // the bar is green over hits that wait.
    expect(page).toMatch(
      /window\.addEventListener\('online', handleOnline\);\s+(?:\/\/[^\n]*\s+)*syncEngine\.sendBehind\(\);/,
    );
  });
});

describe('the sign-in screen', () => {
  const t = (key: string, values?: Record<string, string | number>) =>
    values ? `${key} ${JSON.stringify(values)}` : key;

  it('says nothing when the tablet holds no hit', () => {
    expect(unsentHitsMessage(0, t)).toBeNull();
  });

  it('names one waiting hit, then many with their number', () => {
    expect(unsentHitsMessage(1, t)).toBe('scoring.login.unsentOne');
    expect(unsentHitsMessage(3, t)).toBe('scoring.login.unsentMany {"count":3}');
  });

  it('shows the notice above the two sign-in forms', () => {
    const login = readFileSync(join(__dirname, '..', '..', 'app', 'login', 'page.tsx'), 'utf8');
    expect(login).toMatch(/<UnsentHitsNotice \/>\s+<StaffPinForm/);
    const notice = readFileSync(
      join(__dirname, '..', '..', 'app', 'login', 'UnsentHitsNotice.tsx'),
      'utf8',
    );
    expect(notice).toContain('totalPendingCount()');
    expect(notice).toContain('unsentHitsMessage(');
  });
});
