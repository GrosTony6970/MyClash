/**
 * Retry on the bar sends only the held hits a new send can cure (ruling 291).
 *
 * A hit scored before its bout's last reset is refused for ever (ruling 290).
 * Retry used to send it with the others: it was refused and held again each
 * time, and when it was the only one held the bar offered a Retry that could
 * do nothing. It stays in the inbox now, and the bar then offers Review alone.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { canSendAgain } from './can-send-again';
import { db } from './db';
import { enqueue, getRejected, quarantine, requeueRejected } from './outbox';
import { SyncEngine, type SyncState } from './sync';
import { offersRetry } from '../lib/sync-bar';

const API_URL = 'http://localhost:4000';
const BEFORE_RESET = { message: 'Scored before the reset', code: 'scored_before_reset' };
const NOT_STARTED = { message: 'This bout is not started', code: 'bout_not_started' };

beforeEach(async () => {
  await db.outbox.clear();
  await db.synced.clear();
  await db.rejected.clear();
  vi.restoreAllMocks();
});

/** Answers each POST from the hit it carried; a GET lists no server row. */
function mockApi(post: (clientUuid: string) => { status: number; body: unknown }) {
  const posted: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((_url: string, init?: { method?: string; body?: string }) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      const clientUuid = (JSON.parse(init?.body ?? '{}') as { clientUuid: string }).clientUuid;
      posted.push(clientUuid);
      const r = post(clientUuid);
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

async function hold(
  sequence: number,
  clientUuid: string,
  refusal: typeof BEFORE_RESET,
  matchId = 'm1',
) {
  await quarantine(await addHit(sequence, clientUuid, matchId), refusal.message, refusal.code);
}

function watch(engine: SyncEngine): () => SyncState | undefined {
  const states: SyncState[] = [];
  engine.subscribe((state) => states.push(state));
  return () => states.at(-1);
}

describe('Retry all — a held hit no new send can cure', () => {
  it('stays held, with its reason, while the others go back to the queue', async () => {
    await hold(1, 'uuid-not-started', NOT_STARTED);
    await hold(2, 'uuid-before-reset', BEFORE_RESET);
    await hold(3, 'uuid-locked', { message: 'Match is locked', code: 'BAD_REQUEST' });

    expect(await requeueRejected()).toBe(2);

    expect((await db.outbox.orderBy('id').toArray()).map((row) => row.clientUuid)).toEqual([
      'uuid-not-started',
      'uuid-locked',
    ]);
    const held = await getRejected();
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({
      clientUuid: 'uuid-before-reset',
      rejectedReason: 'Scored before the reset',
      rejectedCode: 'scored_before_reset',
    });
  });

  it('is not sent: the server hears only of the hits it may take', async () => {
    // Of two bouts: behind the one no send can cure, a hit of its own bout waits.
    await hold(1, 'uuid-not-started', NOT_STARTED);
    await hold(2, 'uuid-before-reset', BEFORE_RESET, 'm2');
    const { posted } = mockApi(() => ({ status: 201, body: { id: 'srv-1' } }));
    const engine = new SyncEngine(API_URL);
    const last = watch(engine);

    expect(await engine.retryRejected()).toBe(1);

    expect(posted).toEqual(['uuid-not-started']);
    expect((await db.synced.toArray()).map((row) => row.clientUuid)).toEqual(['uuid-not-started']);
    expect(last()).toMatchObject({
      status: 'error',
      pendingCount: 0,
      rejectedCount: 1,
      sendableCount: 0,
    });
  });

  it('alone, sends nothing and leaves the bar red', async () => {
    await hold(1, 'uuid-before-reset', BEFORE_RESET);
    const { posted } = mockApi(() => ({ status: 409, body: BEFORE_RESET }));
    const engine = new SyncEngine(API_URL);
    const last = watch(engine);

    expect(await engine.retryRejected()).toBe(0);

    expect(posted).toEqual([]);
    expect((await getRejected()).map((row) => row.rejectedCode)).toEqual(['scored_before_reset']);
    expect(last()).toMatchObject({ status: 'error', rejectedCount: 1, sendableCount: 0 });
  });
});

describe('what a drain says of the hits it holds', () => {
  it('counts the ones a new send can cure', async () => {
    await addHit(1, 'uuid-not-started');
    await addHit(2, 'uuid-before-reset', 'm2');
    mockApi((clientUuid) => ({
      status: 409,
      body: clientUuid === 'uuid-before-reset' ? BEFORE_RESET : NOT_STARTED,
    }));
    const engine = new SyncEngine(API_URL);
    const last = watch(engine);

    await engine.drain();

    expect(last()).toMatchObject({ status: 'error', rejectedCount: 2, sendableCount: 1 });
  });
});

describe('a held hit another tab dealt with', () => {
  it('leaves the bar once the inbox opens: Review alone has no other way to find out', async () => {
    await hold(1, 'uuid-before-reset', BEFORE_RESET);
    const engine = new SyncEngine(API_URL);
    const last = watch(engine);
    await engine.retryRejected();
    expect(last()).toMatchObject({ status: 'error', rejectedCount: 1 });

    await db.rejected.clear();
    await engine.refreshState();

    expect(last()).toMatchObject({ status: 'idle', rejectedCount: 0, sendableCount: 0 });
    const inbox = readFileSync(join(__dirname, '..', 'components', 'QuarantineInbox.tsx'), 'utf8');
    expect(inbox).toMatch(/void load\(\);\s+(?:\/\/[^\n]*\s+)*void syncEngine\.refreshState\(\);/);
  });
});

describe('the bar’s Retry', () => {
  const held = { rejected: 1, sendable: 0, pending: 0 };

  it('is not offered when all the tablet holds can never pass', () => {
    expect(offersRetry('error', held)).toBe(false);
    expect(offersRetry('error', { rejected: 3, sendable: 0, pending: 0 })).toBe(false);
  });

  it('is offered while one held hit can be cured, or one still waits', () => {
    expect(offersRetry('error', { rejected: 2, sendable: 1, pending: 0 })).toBe(true);
    expect(offersRetry('error', { rejected: 1, sendable: 0, pending: 1 })).toBe(true);
    expect(offersRetry('error', { rejected: 0, sendable: 0, pending: 0 })).toBe(true);
  });

  it('stays for a session that ended or a refused person: it asks the server again', () => {
    const waits = { ...held, pending: 1 };
    expect(offersRetry('signed-out', waits)).toBe(true);
    expect(offersRetry('account-refused', waits)).toBe(true);
    expect(offersRetry('pin-disabled', waits)).toBe(true);
    expect(offersRetry('pin-role-refused', waits)).toBe(true);
  });

  it('is never offered where the operator has nothing to do', () => {
    const waiting = { rejected: 0, sendable: 0, pending: 2 };
    expect(offersRetry('online', waiting)).toBe(false);
    expect(offersRetry('syncing', waiting)).toBe(false);
    expect(offersRetry('offline', waiting)).toBe(false);
  });

  it('is drawn from that decision, and sends the curable hits only', () => {
    // The pad's vitest mounts no component: the bar is pinned as text.
    const bar = readFileSync(join(__dirname, '..', 'components', 'SyncBar.tsx'), 'utf8');
    expect(bar).toContain('{offersRetry(phase, { rejected, sendable, pending }) && (');
    expect(bar).toContain('const sendable = syncState?.sendableCount ?? 0;');
    expect(bar).toContain('sendable={sendable}');
    expect(bar).toContain('pending={pending}');
    expect(bar).toMatch(
      /sendable > 0 && phase === 'error' \? syncEngine\.retryRejected\(\) : syncEngine\.drain\(\)/,
    );
  });
});

describe('one owner of "a new send can cure it"', () => {
  it('the inbox row and Retry all ask the same question', () => {
    expect(canSendAgain({ rejectedReason: 'x', rejectedCode: 'scored_before_reset' })).toBe(false);
    const read = (...path: string[]) => readFileSync(join(__dirname, '..', ...path), 'utf8');
    expect(read('components', 'QuarantineInbox.tsx')).toContain(
      "import { canSendAgain } from '../offline/can-send-again';",
    );
    expect(read('offline', 'outbox.ts')).toContain('.filter(canSendAgain)');
    expect(read('offline', 'sync.ts')).toContain('.filter(canSendAgain)');
    expect(read('lib', 'refusal-copy.ts')).not.toContain('canSendAgain');
  });
});
