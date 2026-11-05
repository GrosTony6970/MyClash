import { describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  writesTo,
  type ChainResult,
} from '../../common/testing/supabase-chain';
import { photoStoreOf } from './photo-bucket';
import { PHOTO_CLEANUP_RUN_MS } from './photo-cleanup';
import { photoDeletionInstant } from './photo-window';
import { E1, E2, P1, P2, cleanup, key, logger, memoryStore, ok } from './testing/cleanup-doubles';

describe('PhotoCleanup.expire', () => {
  const paris = { event_id: E1, end_date: '2026-05-17', timezone: 'Europe/Paris' };
  const instant = photoDeletionInstant(paris)!.getTime();
  const expiring = (now: number) => {
    const supabase = mockSupabase(
      { event_photos: ok([{ id: P1 }, { id: P2 }]) },
      { event_photo_events: () => ok([paris]) },
    );
    return { supabase, run: () => cleanup(supabase, null, logger(), () => now).expire() };
  };

  it('keeps the photos one millisecond before the deletion instant', async () => {
    const { supabase, run } = expiring(instant - 1);
    expect(await run()).toEqual({ events: [], photos: 0 });
    expect(writesTo(supabase, 'event_photos')).toHaveLength(0);
  });

  it('deletes the photo rows of the Event at the instant, scoped to that Event', async () => {
    const { supabase, run } = expiring(instant);
    expect(await run()).toEqual({ events: [E1], photos: 2 });
    const [write] = writesTo(supabase, 'event_photos');
    expect(write?.op).toBe('delete');
    expect(write?.filters).toEqual([{ method: 'eq', args: ['event_id', E1] }]);
    expect(selectsFor(supabase.from, 'event_photos')).toEqual(['id']);
    expect(supabase.rpc).toHaveBeenCalledWith('event_photo_events');
  });

  it('reads each Event on its own clock: Kiritimati has passed 00:00, New York has not', async () => {
    const kiritimati = { event_id: E1, end_date: '2026-05-17', timezone: 'Pacific/Kiritimati' };
    const newYork = { event_id: E2, end_date: '2026-05-17', timezone: 'America/New_York' };
    // 00:00 on 17 June in Kiritimati is 10:00 UTC on the 16th; in New York, 04:00 UTC on the 17th.
    const now = Date.parse('2026-06-16T12:00:00Z');
    const supabase = mockSupabase(
      { event_photos: ok([{ id: P1 }]) },
      { event_photo_events: () => ok([kiritimati, newYork]) },
    );
    expect(await cleanup(supabase, null, logger(), () => now).expire()).toEqual({
      events: [E1],
      photos: 1,
    });
    expect(writesTo(supabase, 'event_photos').map((w) => w.filters)).toEqual([
      [{ method: 'eq', args: ['event_id', E1] }],
    ]);
  });

  it('warns and keeps the photos of an Event whose end date cannot be read', async () => {
    const supabase = mockSupabase(
      { event_photos: ok([]) },
      { event_photo_events: () => ok([{ ...paris, end_date: 'never' }]) },
    );
    const log = logger();
    expect(await cleanup(supabase, null, log).expire()).toEqual({ events: [], photos: 0 });
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('its photos are not expired'));
  });

  it('fails the run when the listing fails', async () => {
    const supabase = mockSupabase(
      {},
      { event_photo_events: () => ({ data: null, error: { message: 'boom' } }) },
    );
    await expect(cleanup(supabase, null).expire()).rejects.toThrow('Photo expiry not read: boom');
  });

  it('expires the other Events when one delete fails, then fails the run naming it', async () => {
    const other = { event_id: E2, end_date: '2026-05-17', timezone: 'Europe/Paris' };
    const supabase = mockSupabase(
      {
        event_photos: [
          { data: null, error: { message: 'violates foreign key constraint' } },
          ok([{ id: P2 }]),
        ],
      },
      { event_photo_events: () => ok([paris, other]) },
    );
    const log = logger();
    await expect(cleanup(supabase, null, log, () => instant).expire()).rejects.toThrow(
      `Photos of Event ${E1} not expired: violates foreign key constraint`,
    );
    expect(writesTo(supabase, 'event_photos').map((w) => w.filters)).toEqual([
      [{ method: 'eq', args: ['event_id', E1] }],
      [{ method: 'eq', args: ['event_id', E2] }],
    ]);
    expect(log.log).toHaveBeenCalledWith(
      expect.stringContaining(`Expired 1 photos of Event ${E2}`),
    );
  });
});

describe('PhotoCleanup.drain', () => {
  const A = key(E1, P1, 'original');
  const B = key(E1, P1, 'preview');
  /** The tombstone table answers in call order: the read, the delete, the next read. */
  const tombstones = (...answers: ChainResult[]) =>
    mockSupabase({ event_photo_tombstones: answers });

  it('deletes each object in queue order, then its tombstone', async () => {
    const supabase = tombstones(ok([{ object_key: A }, { object_key: B }]), ok(null), ok([]));
    const { store, removed } = memoryStore({ [A]: new Date(), [B]: new Date() });

    expect(await cleanup(supabase, store).drain()).toEqual({ deleted: 2 });

    expect(removed).toEqual([A, B]);
    expect(selectsFor(supabase.from, 'event_photo_tombstones')[0]).toBe('object_key');
    expect(filtersFor(supabase.from, 'event_photo_tombstones', 'order')[0]).toEqual([
      'queued_at',
      { ascending: true },
    ]);
    expect(filtersFor(supabase.from, 'event_photo_tombstones', 'limit')[0]).toEqual([75]);
    const writes = writesTo(supabase, 'event_photo_tombstones');
    expect(writes).toHaveLength(1);
    expect(writes[0]?.op).toBe('delete');
    expect(writes[0]?.filters).toEqual([{ method: 'in', args: ['object_key', [A, B]] }]);
  });

  it('keeps the tombstone of an object the bucket did not delete, and fails the run', async () => {
    const supabase = tombstones(ok([{ object_key: A }, { object_key: B }]), ok(null), ok([]));
    const { store, removed } = memoryStore({ [A]: new Date(), [B]: new Date() }, { failOn: B });
    const log = logger();

    await expect(cleanup(supabase, store, log).drain()).rejects.toThrow(
      `Photo drain stopped at ${B}: Photo bucket did not answer within 10000 ms (delete)`,
    );

    expect(removed).toEqual([A]);
    const writes = writesTo(supabase, 'event_photo_tombstones');
    expect(writes.map((w) => w.filters)).toEqual([[{ method: 'in', args: ['object_key', [A]] }]]);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining(B));
  });

  it('stops at its deadline, keeps what it did not reach, and lets the next run go on', async () => {
    const supabase = tombstones(ok([{ object_key: A }, { object_key: B }]), ok(null), ok([]));
    const start = Date.parse('2026-07-01T12:00:00Z');
    let now = start;
    const { store, removed } = memoryStore(
      { [A]: new Date(), [B]: new Date() },
      { onRemove: () => (now = start + PHOTO_CLEANUP_RUN_MS) },
    );
    const log = logger();

    expect(await cleanup(supabase, store, log, () => now).drain()).toEqual({ deleted: 1 });

    expect(removed).toEqual([A]);
    expect(writesTo(supabase, 'event_photo_tombstones').map((w) => w.filters)).toEqual([
      [{ method: 'in', args: ['object_key', [A]] }],
    ]);
    expect(log.warn).toHaveBeenCalledWith(
      'Photo drain stopped at its deadline; the next run goes on',
    );
  });

  it('clears the tombstone of a key the bucket says is already gone (a second run, or the sweep first)', async () => {
    // Through the real store: S3 may answer a delete of a missing key 404 NoSuchKey.
    const send = vi.fn().mockRejectedValue(
      Object.assign(new Error('NoSuchKey'), {
        name: 'NoSuchKey',
        $metadata: { httpStatusCode: 404 },
      }),
    );
    const store = photoStoreOf(
      {
        kind: 'on',
        config: {
          accessKeyId: 'AK',
          secretAccessKey: 'SK',
          bucket: 'myclash-photos',
          region: 'fr-par',
          endpoint: 'https://s3.fr-par.scw.cloud',
        },
      },
      { send } as never,
    );
    const supabase = tombstones(ok([{ object_key: A }]), ok(null), ok([]));
    expect(await cleanup(supabase, store).drain()).toEqual({ deleted: 1 });
    expect(writesTo(supabase, 'event_photo_tombstones').map((w) => w.filters)).toEqual([
      [{ method: 'in', args: ['object_key', [A]] }],
    ]);
  });

  it('goes on to the next batch when a batch came back full', async () => {
    const full = Array.from({ length: 75 }, (_, i) => `events/${E1}/${P1}/${i}.jpg`);
    const last = key(E2, P2, 'original');
    const supabase = tombstones(
      ok(full.map((object_key) => ({ object_key }))),
      ok(null),
      ok([{ object_key: last }]),
      ok(null),
    );
    const { store, removed } = memoryStore();
    expect(await cleanup(supabase, store).drain()).toEqual({ deleted: 76 });
    expect(removed.at(-1)).toBe(last);
    expect(writesTo(supabase, 'event_photo_tombstones')).toHaveLength(2);
  });

  it('fails the run when the tombstones of deleted objects cannot be cleared', async () => {
    const supabase = tombstones(ok([{ object_key: A }]), {
      data: null,
      error: { message: 'connection reset' },
    });
    const { store, removed } = memoryStore({ [A]: new Date() });
    await expect(cleanup(supabase, store).drain()).rejects.toThrow(
      'Photo tombstones not cleared (their objects are gone): connection reset',
    );
    expect(removed).toEqual([A]);
  });

  it('warns and deletes nothing when the bucket is not configured', async () => {
    const supabase = tombstones(ok([{ object_key: A }]));
    const log = logger();
    expect(await cleanup(supabase, null, log).drain()).toEqual({ deleted: 0 });
    expect(writesTo(supabase, 'event_photo_tombstones')).toHaveLength(0);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('not configured'));
  });

  it('fails loudly when a tombstone it cleared is read again, instead of spinning to the deadline', async () => {
    const full = Array.from({ length: 100 }, (_, i) => `events/${E1}/${P1}/${i}.jpg`);
    const batch = ok(full.map((object_key) => ({ object_key })));
    // The delete "succeeds" and clears nothing: the next read returns the same keys.
    const supabase = tombstones(batch, ok(null), batch);
    const { store } = memoryStore(Object.fromEntries(full.map((k) => [k, new Date()])));
    await expect(cleanup(supabase, store).drain()).rejects.toThrow(
      `Photo tombstone ${full[0]} was cleared but is still there`,
    );
  });

  it('does nothing when no tombstone waits', async () => {
    const { store, removed } = memoryStore();
    expect(await cleanup(tombstones(ok([])), store).drain()).toEqual({ deleted: 0 });
    expect(removed).toEqual([]);
  });
});
