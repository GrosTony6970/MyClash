import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';

import { ScoringDb } from './db';

/**
 * A referee upgrades mid-event with a queue on the tablet. Version 5 added the
 * `undone` table (ruling 350), version 6 adds `undoNotices` (rulings 364 to
 * 366): each must keep every row of the tables before it.
 */
const V4 = {
  outbox: '++id, matchId, clientUuid, createdAt',
  synced: 'clientUuid, matchId, serverId',
  rejected: '++id, matchId, clientUuid, rejectedAt',
  reads: 'path',
};

async function seedOld(version: number, stores: Record<string, string>): Promise<Dexie> {
  const old = new Dexie('myclash-staff');
  old.version(version).stores(stores);
  await old.table('outbox').add({ clientUuid: 'uuid-1', matchId: 'm1', sequence: 1 });
  await old.table('synced').add({ clientUuid: 'uuid-2', matchId: 'm1', serverId: 'srv-2' });
  await old.table('rejected').add({ clientUuid: 'uuid-3', matchId: 'm1', rejectedAt: 1 });
  await old.table('reads').add({ path: 'a-cached-read', body: {}, fetchedAt: 1 });
  return old;
}

async function keptTheFour(db: ScoringDb): Promise<void> {
  expect(await db.outbox.toArray()).toMatchObject([{ clientUuid: 'uuid-1' }]);
  expect(await db.synced.toArray()).toMatchObject([{ serverId: 'srv-2' }]);
  expect(await db.rejected.toArray()).toMatchObject([{ clientUuid: 'uuid-3' }]);
  expect(await db.reads.count()).toBe(1);
}

afterEach(async () => {
  await Dexie.delete('myclash-staff');
});

describe('the tablet’s store, upgraded to version 6', () => {
  it('from version 4: keeps every waiting, sent, held and cached row', async () => {
    (await seedOld(4, V4)).close();

    const db = new ScoringDb();

    await keptTheFour(db);
    expect(await db.undone.toArray()).toEqual([]);
    expect(await db.undoNotices.toArray()).toEqual([]);
    expect(db.verno).toBe(6);
    db.close();
  });

  it('from version 5: keeps the undos written down too, and starts with no notice', async () => {
    const old = await seedOld(5, { ...V4, undone: 'clientUuid' });
    await old.table('undone').add({ clientUuid: 'uuid-5', matchId: 'm1', undoneAt: 1 });
    old.close();

    const db = new ScoringDb();

    await keptTheFour(db);
    expect(await db.undone.toArray()).toEqual([
      { clientUuid: 'uuid-5', matchId: 'm1', undoneAt: 1 },
    ]);
    expect(await db.undoNotices.toArray()).toEqual([]);
    expect(db.verno).toBe(6);
    db.close();
  });

  it('reads the notices of one bout by its index', async () => {
    const db = new ScoringDb();
    await db.undoNotices.bulkPut([
      { clientUuid: 'uuid-1', matchId: 'm1', why: 'ended' },
      { clientUuid: 'uuid-2', matchId: 'm2', why: 'expired' },
    ]);

    expect(await db.undoNotices.where('matchId').equals('m2').toArray()).toEqual([
      { clientUuid: 'uuid-2', matchId: 'm2', why: 'expired' },
    ]);
    db.close();
  });
});
