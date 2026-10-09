import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';

import { settleUndone } from '../lib/settle-undone';
import { db, type UndoNotice } from './db';
import { dropUnreadNotices, noticesOf } from './undo-notices';

/**
 * A notice nobody read for a day is removed (operator ruling 370).
 *
 * Marc undoes a hit on bout A with no wifi and never opens bout A again. A day later the
 * tablet lets the undo go and writes a notice for bout A's screen. Nobody opens that screen:
 * the row stayed on the tablet for ever. A notice is now kept one day, as an undo nobody
 * could send is. A screen that opens later says nothing of it, and the settle removes it.
 */
const API_URL = 'http://localhost:4000';
const HOUR = 60 * 60 * 1000;

const wrote = (clientUuid: string, matchId: string, hoursAgo: number): UndoNotice => ({
  clientUuid,
  matchId,
  why: 'expired',
  writtenAt: Date.now() - hoursAgo * HOUR,
});
const kept = async () => (await db.undoNotices.toArray()).map((notice) => notice.clientUuid).sort();

beforeEach(async () => {
  await db.undone.clear();
  await db.undoNotices.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a notice is said for a day (ruling 370)', () => {
  it('is said to a screen that opens within the day, and not after it', async () => {
    await db.undoNotices.bulkPut([
      wrote('uuid-old', 'bout-a', 24),
      wrote('uuid-new', 'bout-a', 23),
      wrote('uuid-other', 'bout-b', 1),
    ]);

    expect((await noticesOf('bout-a')).map((notice) => notice.clientUuid)).toEqual(['uuid-new']);
  });
});

describe('a notice nobody read for a day is removed (ruling 370)', () => {
  it('removes the old ones of every bout, and keeps the others', async () => {
    await db.undoNotices.bulkPut([
      wrote('uuid-1', 'bout-a', 30),
      wrote('uuid-2', 'bout-a', 2),
      wrote('uuid-3', 'bout-b', 24),
      wrote('uuid-4', 'bout-b', 23),
    ]);

    await dropUnreadNotices();

    expect(await kept()).toEqual(['uuid-2', 'uuid-4']);
  });

  it('is done by every run of the settle, with nothing else to settle', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await db.undoNotices.bulkPut([wrote('uuid-1', 'bout-a', 30), wrote('uuid-2', 'bout-a', 2)]);

    await expect(settleUndone(API_URL)).resolves.toEqual(new Map());

    expect(await kept()).toEqual(['uuid-2']);
  });

  // The removal is housekeeping: a store that refuses it must not stop an undo being settled.
  it('ends no settle when it fails, and leaves a trace', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(db.undoNotices, 'filter').mockImplementation(() => {
      throw new Error('the store failed');
    });

    await expect(settleUndone(API_URL)).resolves.toEqual(new Map());

    expect(logged).toHaveBeenCalledWith(
      '[undo] the notices nobody read could not be removed',
      expect.any(Error),
    );
  });

  // The undo the settle lets go after a day is written NOW: its notice starts its own day.
  it('gives the notice of an undo let go after a day its own day', async () => {
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await db.undone.put({
      clientUuid: 'uuid-5',
      matchId: 'bout-a',
      undoneAt: Date.now() - 30 * HOUR,
    });
    const before = Date.now();

    await settleUndone(API_URL);

    const [notice] = await noticesOf('bout-a');
    expect(notice).toMatchObject({ clientUuid: 'uuid-5', why: 'expired' });
    expect(notice?.writtenAt).toBeGreaterThanOrEqual(before);
    expect(notice?.writtenAt).toBeLessThanOrEqual(Date.now());
  });
});
