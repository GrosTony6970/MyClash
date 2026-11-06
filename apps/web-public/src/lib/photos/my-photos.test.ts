import { afterEach, describe, expect, it, vi } from 'vitest';
import { messages } from '@myclash/i18n/public';
import { createTranslator } from '@myclash/i18n/runtime';
import type { MyPhoto, MyPhotos } from '@myclash/types';
import { feedAfterFirstPage, type PhotoFeed } from './photo-feed';
import { deleteMyPhoto, myPhotosPath, readMyPhotos, withoutDeleted } from './my-photos';

/**
 * Her own photos of one Event, in her personal space (slice 6b): the list's address, its read,
 * the photos she deleted kept out of every answer, and her Delete.
 */

const t = createTranslator(messages.en);
const BASE = Date.parse('2026-03-14T18:00:00.000Z');

function photo(i: number): MyPhoto {
  return {
    id: `p${i}`,
    status: 'waiting',
    caption: null,
    tag: null,
    createdAt: new Date(BASE - i * 60_000).toISOString().replace('Z', '+00:00'),
    previewUrl: null,
    originalUrl: null,
  };
}

const mine = (photos: MyPhoto[], next: string | null = null): MyPhotos => ({
  posterName: 'Léa Martin',
  sendOpen: true,
  photos,
  next,
});

afterEach(() => vi.unstubAllGlobals());

function answering(status: number, body?: unknown) {
  const fetch = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status }),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('the address of her photos', () => {
  it('is her own Event route, with the cursor when given', () => {
    expect(myPhotosPath('ev-1')).toBe('/api/v1/me/events/ev-1/photos');
    expect(myPhotosPath('ev-1', '2026-03-14T18:00:00.123456+00:00')).toBe(
      '/api/v1/me/events/ev-1/photos?before=2026-03-14T18%3A00%3A00.123456%2B00%3A00',
    );
  });
});

describe('a read of her photos', () => {
  it('is data for a page of hers', async () => {
    answering(200, mine([photo(0)]));
    expect(await readMyPhotos('https://api.test', '/x')).toEqual({
      kind: 'data',
      data: mine([photo(0)]),
    });
  });

  it('is a failed read for a body that is not her page (the catch-all answers {})', async () => {
    const bodies = [
      {},
      { photos: [], next: null, posterName: null },
      { photos: {}, next: null, posterName: null, sendOpen: true },
      { photos: [], next: 3, posterName: null, sendOpen: true },
      { photos: [], next: null, posterName: 7, sendOpen: true },
      { photos: [], next: null, posterName: null, sendOpen: 'yes' },
    ];
    for (const body of bodies) {
      answering(200, body);
      expect(await readMyPhotos('https://api.test', '/x')).toEqual({ kind: 'failed' });
    }
  });

  it('is failed on a 401, a 404 and a 500, aborted when the page left', async () => {
    for (const status of [401, 404, 500]) {
      answering(status, { statusCode: status });
      expect(await readMyPhotos('https://api.test', '/x')).toEqual({ kind: 'failed' });
    }
    const left = new AbortController();
    left.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }),
    );
    expect(await readMyPhotos('https://api.test', '/x', left.signal)).toEqual({ kind: 'aborted' });
  });
});

describe('the photos she deleted', () => {
  it('are kept out of a page, its cursor kept', () => {
    const page = mine([photo(0), photo(1), photo(2)], 'cursor');
    expect(withoutDeleted(page, new Set(['p1']))).toEqual(mine([photo(0), photo(2)], 'cursor'));
  });

  it('a page read before a delete does not bring the photo back', () => {
    const shown: PhotoFeed<MyPhoto> = { photos: [photo(0), photo(2)], more: false };
    const late = mine([photo(0), photo(1), photo(2)]);
    const after = feedAfterFirstPage(shown, withoutDeleted(late, new Set(['p1'])));
    expect(after.photos.map((p) => p.id)).toEqual(['p0', 'p2']);
  });
});

describe('her Delete', () => {
  it('deletes her photo by its own route, and a 204 is done', async () => {
    const fetch = answering(204);
    expect(await deleteMyPhoto('https://api.test', 'ev-1', 'p1', t)).toEqual({ kind: 'deleted' });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.test/api/v1/me/events/ev-1/photos/p1');
    expect(init?.method).toBe('DELETE');
  });

  it('a photo already gone is done too (deleted from another tab)', async () => {
    answering(404, { statusCode: 404, code: 'photo_not_found' });
    expect(await deleteMyPhoto('https://api.test', 'ev-1', 'p1', t)).toEqual({ kind: 'deleted' });
  });

  it('a 404 that is not her photo gone (a proxy, a route) is a failure, not a delete', async () => {
    answering(404, { statusCode: 404 });
    expect(await deleteMyPhoto('https://api.test', 'ev-1', 'p1', t)).toEqual({
      kind: 'failed',
      message: t('publicApp.myPhotos.deleteFailed'),
    });
  });

  it('any other failure says the photo was not deleted', async () => {
    answering(503, { statusCode: 503 });
    expect(await deleteMyPhoto('https://api.test', 'ev-1', 'p1', t)).toEqual({
      kind: 'failed',
      message: t('publicApp.myPhotos.deleteFailed'),
    });
  });
});
