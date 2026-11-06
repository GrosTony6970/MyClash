// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MyPhoto, MyPhotos } from '@myclash/types';
import { useMyPhotos } from './use-my-photos';

/**
 * Her photo list in her personal space (slice 6b): the races the hook owns. Every answer is held
 * until the test releases it, so the order of the answers is the test's.
 */

type Held = { url: string; method: string; release: (status: number, body?: unknown) => void };

let container: HTMLDivElement;
let root: Root;
let seen: ReturnType<typeof useMyPhotos>;
let held: Held[];

const t = (key: string) => key;

function Probe() {
  seen = useMyPhotos('ev-1', t);
  return null;
}

function photo(i: number): MyPhoto {
  return {
    id: `p${i}`,
    status: 'approved',
    caption: null,
    tag: null,
    createdAt: new Date(Date.UTC(2026, 2, 14, 18, 60 - i)).toISOString().replace('Z', '+00:00'),
    previewUrl: null,
    originalUrl: null,
  };
}
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, k) => photo(from + k));
const page = (photos: MyPhoto[], next: string | null = null): MyPhotos => ({
  posterName: 'Léa Martin',
  sendOpen: true,
  photos,
  next,
});

/** The calls made, oldest first, each answered when the test says. An aborted one rejects. */
function holding() {
  held = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
          held.push({
            url,
            method: init?.method ?? 'GET',
            release: (status, body) =>
              resolve(new Response(body === undefined ? null : JSON.stringify(body), { status })),
          });
        }),
    ),
  );
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const ids = () => seen.photos.map((p) => p.id);

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  holding();
  container = document.createElement('div');
  root = createRoot(container);
  act(() => root.render(<Probe />));
  await flush();
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe('useMyPhotos', () => {
  it('a page read before a delete does not bring the photo back', async () => {
    held[0]!.release(200, page(range(0, 2)));
    await flush();
    act(() => {
      seen.refresh();
    });
    await flush();
    const late = held[1]!;

    const removing = seen.remove('p1');
    await flush();
    held[2]!.release(204);
    await act(async () => removing);
    expect(ids()).toEqual(['p0', 'p2']);

    late.release(200, page(range(0, 2)));
    await flush();
    expect(ids()).toEqual(['p0', 'p2']);
  });

  it('two reads of the first page: the older answer, landing last, changes nothing', async () => {
    held[0]!.release(200, page(range(0, 1)));
    await flush();
    act(() => {
      seen.refresh();
    });
    act(() => {
      seen.refresh();
    });
    await flush();
    held[2]!.release(200, page(range(0, 2)));
    await flush();
    held[1]!.release(200, page(range(0, 0)));
    await flush();
    expect(ids()).toEqual(['p0', 'p1', 'p2']);
  });

  it('Load more reads from the last photo shown and adds the next page under it', async () => {
    held[0]!.release(200, page(range(0, 29), photo(29).createdAt));
    await flush();
    const more = seen.loadMore();
    await flush();
    expect(held[1]!.url).toContain(`before=${encodeURIComponent(photo(29).createdAt)}`);
    held[1]!.release(200, page(range(30, 30)));
    await act(async () => more);
    expect(ids()).toHaveLength(31);
    expect(seen.hasMore).toBe(false);
  });

  it('a Load more landing after a refresh that stood alone is dropped: no gap', async () => {
    held[0]!.release(200, page(range(0, 29), photo(29).createdAt));
    await flush();
    const more = seen.loadMore();
    await flush();
    act(() => {
      seen.refresh();
    });
    await flush();
    // Thirty photos newer than all of hers arrived: the refresh's page stands alone.
    const newer = range(0, 29).map((p, k) => ({
      ...p,
      id: `n${k}`,
      createdAt: new Date(Date.UTC(2026, 2, 14, 21, 60 - k)).toISOString().replace('Z', '+00:00'),
    }));
    held[2]!.release(200, page(newer, newer[29]!.createdAt));
    await flush();
    held[1]!.release(200, page(range(30, 30)));
    await act(async () => more);
    expect(ids()).toEqual(newer.map((p) => p.id));
    expect(seen.hasMore).toBe(true);
  });

  it('a first read that fails says so, and Try again reads once more', async () => {
    held[0]!.release(500, { statusCode: 500 });
    await flush();
    expect(seen.status).toBe('failed');
    act(() => seen.retry());
    expect(seen.status).toBe('loading');
    await flush();
    held[1]!.release(200, page(range(0, 0)));
    await flush();
    expect(seen).toMatchObject({ status: 'shown', posterName: 'Léa Martin', sendOpen: true });
  });

  it('a Delete that fails keeps the photo and says why under it', async () => {
    held[0]!.release(200, page(range(0, 1)));
    await flush();
    const removing = seen.remove('p0');
    await flush();
    expect(seen.removing.has('p0')).toBe(true);
    held[1]!.release(503, { statusCode: 503 });
    await act(async () => removing);
    expect(ids()).toEqual(['p0', 'p1']);
    expect(seen.failedDelete['p0']).toBe('publicApp.myPhotos.deleteFailed');
    expect(seen.removing.has('p0')).toBe(false);
  });
});
