import { describe, expect, it } from 'vitest';
import { mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import type { PhotoStore } from './photo-bucket';
import { PHOTO_CLEANUP_RUN_MS, PHOTO_ORPHAN_GRACE_MS } from './photo-cleanup';
import { E1, E2, P1, P2, cleanup, key, logger, memoryStore, ok } from './testing/cleanup-doubles';

describe('PhotoCleanup.sweep', () => {
  const now = Date.parse('2026-07-01T12:00:00Z');
  const hoursAgo = (h: number) => new Date(now - h * 60 * 60_000);
  /** This database holds Events E1 and E2, and the photo rows `ids`. */
  const rows = (...ids: string[]) =>
    mockSupabase(
      {
        events: { rows: [{ id: E1 }, { id: E2 }] },
        event_photos: { rows: ids.map((id) => ({ id })) },
      },
      { event_photo_events: () => ok([]) },
    );
  const sweep = (
    supabase: ReturnType<typeof mockSupabase>,
    store: PhotoStore,
    log = logger(),
    clock = () => now,
  ) => cleanup(supabase, store, log, clock).sweep();

  it('deletes an object an hour old that no photo row names, and keeps one a row names', async () => {
    const orphan = key(E1, P2, 'original');
    const kept = key(E1, P1, 'original');
    const { store, removed } = memoryStore({ [orphan]: hoursAgo(2), [kept]: hoursAgo(2) });
    const supabase = rows(P1);

    expect(await sweep(supabase, store)).toEqual({ deleted: 1 });

    expect(removed).toEqual([orphan]);
    expect(selectsFor(supabase.from, 'event_photos')).toEqual(['id']);
  });

  it('keeps a young object with no row: an upload in flight writes its row last', async () => {
    const young = key(E1, P2, 'original');
    const { store, removed } = memoryStore({ [young]: new Date(now - PHOTO_ORPHAN_GRACE_MS + 1) });
    expect(await sweep(rows(), store)).toEqual({ deleted: 0 });
    expect(removed).toEqual([]);
  });

  it('leaves alone an old key of an Event this database does not hold: another stack may share the bucket', async () => {
    const elsewhere = key('33333333-3333-4333-8333-333333333333', P2, 'original');
    const { store, removed } = memoryStore({ [elsewhere]: hoursAgo(2) });
    const supabase = rows();
    const log = logger();
    expect(await sweep(supabase, store, log)).toEqual({ deleted: 0 });
    expect(removed).toEqual([]);
    expect(selectsFor(supabase.from, 'events')).toEqual(['id']);
    expect(log.warn).toHaveBeenCalledWith('1 photo bucket keys of no Event here left alone');
  });

  it('leaves alone an old key in a shape the upload never writes', async () => {
    const stray = 'events/x/stray.txt';
    const { store, removed } = memoryStore({ [stray]: hoursAgo(2) });
    const log = logger();
    expect(await sweep(rows(), store, log)).toEqual({ deleted: 0 });
    expect(removed).toEqual([]);
    expect(log.warn).toHaveBeenCalledWith('1 photo bucket keys in an unknown shape left alone');
  });

  it('refuses to judge anything when it cannot read as the service role', async () => {
    // A wrong key reads the deny-all photo table as empty, with no error: every image would look
    // orphaned. The service-role-only function fails first.
    const orphan = key(E1, P2, 'original');
    const { store, removed, lists } = memoryStore({ [orphan]: hoursAgo(2) });
    const supabase = mockSupabase(
      { events: { rows: [{ id: E1 }] }, event_photos: { rows: [] } },
      {
        event_photo_events: () => ({
          data: null,
          error: { message: 'permission denied for function event_photo_events' },
        }),
      },
    );
    await expect(sweep(supabase, store)).rejects.toThrow(
      'Orphan sweep refused: the photo rows cannot be read as the service role',
    );
    expect(lists).toEqual([]);
    expect(removed).toEqual([]);
  });

  it('reads every page of the listing under events/', async () => {
    const a = key(E1, P1, 'original');
    const b = key(E2, P2, 'original');
    const { store, removed, lists } = memoryStore(
      { [a]: hoursAgo(2), [b]: hoursAgo(2) },
      { pageSize: 1 },
    );
    expect(await sweep(rows(), store)).toEqual({ deleted: 2 });
    expect(lists).toEqual([
      ['events/', undefined],
      ['events/', a],
    ]);
    expect(removed).toEqual([a, b]);
  });

  it('stops at its deadline after one page', async () => {
    const a = key(E1, P1, 'original');
    const b = key(E2, P2, 'original');
    let clock = now;
    const { store, lists } = memoryStore(
      { [a]: hoursAgo(2), [b]: hoursAgo(2) },
      { pageSize: 1, onRemove: () => (clock = now + PHOTO_CLEANUP_RUN_MS) },
    );
    const log = logger();
    expect(await sweep(rows(), store, log, () => clock)).toEqual({ deleted: 1 });
    expect(lists).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledWith(
      'Photo orphan sweep stopped at its deadline; the next run goes on',
    );
  });

  it('says how many listed entries it could not judge', async () => {
    const { store } = memoryStore({}, { undated: 2 });
    const log = logger();
    expect(await sweep(rows(), store, log)).toEqual({ deleted: 0 });
    expect(log.warn).toHaveBeenCalledWith(
      '2 listed photo bucket entries had no key or date; left alone',
    );
  });

  it('says once, plainly, that a stack with no bucket has nothing to sweep', async () => {
    const log = logger();
    expect(await cleanup(rows(), null, log).sweep()).toEqual({ deleted: 0 });
    expect(log.log).toHaveBeenCalledWith('The photo bucket is not configured; no orphan sweep');
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('fails the run when the bucket refuses a delete', async () => {
    const orphan = key(E1, P2, 'original');
    const { store } = memoryStore({ [orphan]: hoursAgo(2) }, { failOn: orphan });
    await expect(sweep(rows(), store)).rejects.toThrow(`Photo orphan sweep stopped at ${orphan}`);
  });
});
