/**
 * reconcile.test.ts — T-504 acceptance criteria
 *
 * AC:
 *   ✓ Local pending preserved; server state replayed; final state = union
 *   ✓ 20 offline + admin voids one online → both states reconciled
 */

import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import { enqueue } from './outbox';
import { reconcile, type ServerExchange } from './reconcile';

beforeEach(async () => {
  await db.outbox.clear();
  await db.synced.clear();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeServerEx(seq: number, uuid: string, voided = false): ServerExchange {
  return {
    id: `srv-${uuid}`,
    clientUuid: uuid,
    matchId: 'm1',
    sequence: seq,
    type: 'clean',
    occurredAt: new Date().toISOString(),
    voided,
  };
}

// ── Union: local pending preserved ───────────────────────────────────────────

describe('reconcile — union', () => {
  it('preserves local pending entries not on server', async () => {
    // 3 local pending
    await enqueue({
      clientUuid: 'local-1',
      matchId: 'm1',
      sequence: 1,
      type: 'clean',
      occurredAt: '',
    });
    await enqueue({
      clientUuid: 'local-2',
      matchId: 'm1',
      sequence: 2,
      type: 'clean',
      occurredAt: '',
    });
    await enqueue({
      clientUuid: 'local-3',
      matchId: 'm1',
      sequence: 3,
      type: 'clean',
      occurredAt: '',
    });

    // Server has none of them yet
    const result = await reconcile('m1', []);

    expect(result.preserved).toBe(3);
    expect(result.added).toBe(0);
    expect(result.voided).toBe(0);
    expect(await db.outbox.count()).toBe(3);
  });

  it('adds server exchanges not in local synced', async () => {
    // Server has 2 exchanges we never saw (e.g. entered on another device)
    const serverExchanges = [makeServerEx(1, 'server-only-1'), makeServerEx(2, 'server-only-2')];

    const result = await reconcile('m1', serverExchanges);

    expect(result.added).toBe(2);
    expect(await db.synced.count()).toBe(2);
  });

  it('does not duplicate already-synced entries', async () => {
    // Already in synced
    await db.synced.put({
      clientUuid: 'already-synced',
      matchId: 'm1',
      sequence: 1,
      serverId: 'srv-already-synced',
      syncedAt: Date.now(),
    });

    const result = await reconcile('m1', [makeServerEx(1, 'already-synced')]);

    expect(result.added).toBe(0);
    expect(await db.synced.count()).toBe(1); // no duplicate
  });
});

// ── Void handling ─────────────────────────────────────────────────────────────

describe('reconcile — voided exchanges', () => {
  it('removes voided exchange from outbox', async () => {
    await enqueue({
      clientUuid: 'to-void',
      matchId: 'm1',
      sequence: 1,
      type: 'clean',
      occurredAt: '',
    });

    const result = await reconcile('m1', [makeServerEx(1, 'to-void', true)]);

    expect(result.voided).toBe(1);
    expect(await db.outbox.count()).toBe(0);
  });

  it('removes voided exchange from synced', async () => {
    await db.synced.put({
      clientUuid: 'synced-then-voided',
      matchId: 'm1',
      sequence: 1,
      serverId: 'srv-1',
      syncedAt: Date.now(),
    });

    await reconcile('m1', [makeServerEx(1, 'synced-then-voided', true)]);

    expect(await db.synced.count()).toBe(0);
  });
});

// ── KEY AC: 20 offline + admin voids one ─────────────────────────────────────

describe('reconcile — 20 offline + 1 admin void', () => {
  it('preserves 19 pending, removes 1 voided, adds 0 server-only', async () => {
    // Enter 20 exchanges offline
    for (let i = 1; i <= 20; i++) {
      await enqueue({
        clientUuid: `offline-${i}`,
        matchId: 'm1',
        sequence: i,
        type: 'clean',
        occurredAt: '',
      });
    }

    // Admin voids exchange #5 on server
    // Server returns all 20 exchanges, #5 marked voided
    const serverExchanges: ServerExchange[] = Array.from({ length: 20 }, (_, i) =>
      makeServerEx(i + 1, `offline-${i + 1}`, i + 1 === 5),
    );

    const result = await reconcile('m1', serverExchanges);

    expect(result.voided).toBe(1);
    expect(result.preserved).toBe(19); // 20 - 1 voided
    expect(result.added).toBe(0); // all were local

    // Outbox has 19 remaining
    expect(await db.outbox.count()).toBe(19);
    // Voided one is gone
    const voidedEntry = await db.outbox.where('clientUuid').equals('offline-5').first();
    expect(voidedEntry).toBeUndefined();
  });
});

// ── Cross-match isolation ─────────────────────────────────────────────────────

describe('reconcile — cross-match isolation', () => {
  it('only touches entries for the given matchId', async () => {
    await enqueue({
      clientUuid: 'm1-entry',
      matchId: 'm1',
      sequence: 1,
      type: 'clean',
      occurredAt: '',
    });
    await enqueue({
      clientUuid: 'm2-entry',
      matchId: 'm2',
      sequence: 1,
      type: 'clean',
      occurredAt: '',
    });

    await reconcile('m1', [makeServerEx(1, 'm1-entry', true)]);

    // m1 entry voided, m2 entry untouched
    expect(await db.outbox.where('matchId').equals('m1').count()).toBe(0);
    expect(await db.outbox.where('matchId').equals('m2').count()).toBe(1);
  });
});
