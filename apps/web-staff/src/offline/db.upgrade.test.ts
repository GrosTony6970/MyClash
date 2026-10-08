import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';

import { ScoringDb } from './db';

/**
 * A referee upgrades mid-event with a queue on the tablet: version 5 adds the
 * `undone` table (ruling 350) and must keep every row of the four before it.
 */
describe('the tablet’s store, from version 4 to version 5', () => {
  it('keeps every waiting, sent, held and cached row, and starts `undone` empty', async () => {
    const old = new Dexie('myclash-staff');
    old.version(4).stores({
      outbox: '++id, matchId, clientUuid, createdAt',
      synced: 'clientUuid, matchId, serverId',
      rejected: '++id, matchId, clientUuid, rejectedAt',
      reads: 'path',
    });
    await old.table('outbox').add({ clientUuid: 'uuid-1', matchId: 'm1', sequence: 1 });
    await old.table('synced').add({ clientUuid: 'uuid-2', matchId: 'm1', serverId: 'srv-2' });
    await old.table('rejected').add({ clientUuid: 'uuid-3', matchId: 'm1', rejectedAt: 1 });
    await old.table('reads').add({ path: 'a-cached-read', body: {}, fetchedAt: 1 });
    old.close();

    const db = new ScoringDb();

    expect(await db.outbox.toArray()).toMatchObject([{ clientUuid: 'uuid-1' }]);
    expect(await db.synced.toArray()).toMatchObject([{ serverId: 'srv-2' }]);
    expect(await db.rejected.toArray()).toMatchObject([{ clientUuid: 'uuid-3' }]);
    expect(await db.reads.count()).toBe(1);
    expect(await db.undone.toArray()).toEqual([]);
    expect(db.verno).toBe(5);
    db.close();
  });
});
