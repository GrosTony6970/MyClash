import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicPhoto, PublicPhotoPage } from '@myclash/types';
import {
  feedAfterFirstPage,
  feedAfterMore,
  feedCursor,
  photoPagePath,
  readPhotoPage,
  type PhotoFeed,
} from './photo-feed';

/**
 * The public photo list's rules (slice 4b): the 30 s read of the newest page, Load more, and the
 * cursor between them. The server pages newest first, 30 a page, `next` = the last row's
 * `created_at` as Postgres wrote it (`+00:00`), or null when the page is the last.
 */

const BASE = Date.parse('2026-03-14T18:00:00.000Z');

/** Photo `i` is `i` minutes older than photo 0, its time in the server's shape. */
function photo(i: number, id = `p${i}`): PublicPhoto {
  return {
    id,
    uploaderName: null,
    caption: null,
    tag: null,
    createdAt: new Date(BASE - i * 60_000).toISOString().replace('Z', '+00:00'),
    previewUrl: `https://bucket.test/${id}/preview.jpg`,
    originalUrl: `https://bucket.test/${id}/original.jpg`,
  };
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, k) => photo(from + k));

/** A page as the server answers it: `next` set when it is full. */
function page(photos: PublicPhoto[], full = photos.length === 30): PublicPhotoPage {
  return { photos, next: full ? photos[photos.length - 1]!.createdAt : null };
}

const ids = (feed: PhotoFeed) => feed.photos.map((p) => p.id);

describe('the newest page, read every 30 s', () => {
  it('is the whole list when the server has no more: older photos on screen were deleted', () => {
    const shown = { photos: range(0, 39), more: false };
    const fresh = feedAfterFirstPage(shown, page(range(0, 9)));
    expect(ids(fresh)).toEqual(ids({ photos: range(0, 9), more: false }));
    expect(fresh.more).toBe(false);
  });

  it('is the first read: the page, with Load more when it is full', () => {
    expect(feedAfterFirstPage(null, page(range(0, 29))).more).toBe(true);
    expect(feedAfterFirstPage(null, page(range(0, 5))).more).toBe(false);
  });

  it('puts new photos on top and keeps every loaded photo below them', () => {
    // 60 on screen (old1…old60); two arrive; the newest page = the 2 new + old1…old28.
    const old = Array.from({ length: 60 }, (_, k) => photo(k + 2, `old${k + 1}`));
    const fresh = [photo(0, 'new1'), photo(1, 'new2')];
    const result = feedAfterFirstPage(
      { photos: old, more: true },
      page([...fresh, ...old.slice(0, 28)]),
    );
    expect(result.photos).toHaveLength(62);
    expect(ids(result)).toEqual(['new1', 'new2', ...old.map((p) => p.id)]);
    expect(result.more).toBe(true);
  });

  it('drops a photo deleted among the newest', () => {
    const shown = { photos: range(0, 59), more: false };
    const newest = range(0, 30).filter((p) => p.id !== 'p3');
    const result = feedAfterFirstPage(shown, page(newest));
    expect(ids(result)).not.toContain('p3');
    expect(ids(result)).toHaveLength(59);
    expect(result.more).toBe(false);
  });

  it('when more than 30 arrived since, is the page alone with Load more: never a gap', () => {
    // 10 on screen, then 35 new: the newest page does not reach what is on screen.
    const shown = { photos: Array.from({ length: 10 }, (_, k) => photo(40 + k)), more: false };
    const result = feedAfterFirstPage(shown, page(range(0, 29)));
    expect(ids(result)).toEqual(ids({ photos: range(0, 29), more: true }));
    expect(result.more).toBe(true);
  });

  it('with exactly 30 photos, after Load more found none, keeps Load more closed', () => {
    const shown = { photos: range(0, 29), more: false };
    expect(feedAfterFirstPage(shown, page(range(0, 29))).more).toBe(false);
  });

  it('never shows a photo twice, whichever answer lands first', () => {
    const shown = { photos: range(2, 31), more: true };
    const newest = page(range(0, 29));
    const older = page(range(32, 61));

    const before = feedCursor(shown)!;

    const refreshFirst = feedAfterMore(feedAfterFirstPage(shown, newest), older, before);
    const moreFirst = feedAfterFirstPage(feedAfterMore(shown, older, before), newest);

    for (const result of [refreshFirst, moreFirst]) {
      expect(new Set(ids(result)).size).toBe(result.photos.length);
      expect(ids(result)).toEqual(range(0, 61).map((p) => p.id));
    }
  });

  it('a Load more that lands after a read that stood alone is dropped: no gap, in either order', () => {
    // On screen: p40…p69. Load more is out from p69. Then 40 photos arrive (p0…p39): the newest
    // page, p0…p29, stands alone. The Load more's page, p70…p99, belongs under p69.
    const shown = { photos: range(40, 69), more: true };
    const before = feedCursor(shown)!;
    const newest = page(range(0, 29));
    const older = page(range(70, 99));

    const refreshFirst = feedAfterMore(feedAfterFirstPage(shown, newest), older, before);
    expect(ids(refreshFirst)).toEqual(range(0, 29).map((p) => p.id));
    expect(feedCursor(refreshFirst)).toBe(photo(29).createdAt);

    const moreFirst = feedAfterFirstPage(feedAfterMore(shown, older, before), newest);
    expect(ids(moreFirst)).toEqual(range(0, 29).map((p) => p.id));
    expect(feedCursor(moreFirst)).toBe(photo(29).createdAt);
  });
});

describe('Load more', () => {
  it("appends the next page and takes the server's next", () => {
    const shown = { photos: range(0, 29), more: true };
    const before = feedCursor(shown)!;
    const last = feedAfterMore(shown, page(range(30, 34)), before);
    expect(ids(last)).toEqual(range(0, 34).map((p) => p.id));
    expect(last.more).toBe(false);
    expect(feedAfterMore(shown, page(range(30, 59)), before).more).toBe(true);
  });

  it("asks from the last photo's time while there are more, else not at all", () => {
    expect(feedCursor({ photos: range(0, 29), more: true })).toBe(photo(29).createdAt);
    expect(feedCursor({ photos: range(0, 29), more: false })).toBeNull();
    expect(feedCursor({ photos: [], more: false })).toBeNull();
  });
});

describe('the read', () => {
  const T = '11111111-1111-4111-8111-111111111111';

  it('carries the filter and the cursor, encoded', () => {
    const before = '2026-03-14T18:00:00.123456+00:00';
    expect(photoPagePath('ev-1', '')).toBe('/api/v1/events/ev-1/photos/public');
    expect(photoPagePath('ev-1', `t:${T}`)).toBe(
      `/api/v1/events/ev-1/photos/public?tournamentId=${T}`,
    );
    expect(photoPagePath('ev-1', `w:${T}`, before)).toBe(
      `/api/v1/events/ev-1/photos/public?workshopId=${T}&before=2026-03-14T18%3A00%3A00.123456%2B00%3A00`,
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  const answering = (status: number, body: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status })),
    );

  it('is data for a page, and a failed read for a body that is not one', async () => {
    answering(200, page(range(0, 2)));
    expect((await readPhotoPage('https://api.test', '/x')).kind).toBe('data');
    for (const body of [{}, { photos: [] }, { photos: {}, next: null }, { photos: [], next: 3 }]) {
      answering(200, body);
      expect(await readPhotoPage('https://api.test', '/x')).toEqual({ kind: 'failed' });
    }
  });

  it('is notFound on a 404, failed on a 429 or a network fault, aborted when the page left', async () => {
    answering(404, { statusCode: 404, detail: 'Event not found' });
    expect(await readPhotoPage('https://api.test', '/x')).toEqual({ kind: 'notFound' });
    answering(429, { statusCode: 429 });
    expect(await readPhotoPage('https://api.test', '/x')).toEqual({ kind: 'failed' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    expect(await readPhotoPage('https://api.test', '/x')).toEqual({ kind: 'failed' });

    const left = new AbortController();
    left.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }),
    );
    expect(await readPhotoPage('https://api.test', '/x', left.signal)).toEqual({ kind: 'aborted' });
  });
});
