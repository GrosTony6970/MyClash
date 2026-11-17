import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ServiceUnavailableException } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { storageGaveNoAnswer } from '../../common/storage-answer';
import { ensurePublicBucket } from '../../common/storage-bucket';
import { collectArchiveImages, type ArchiveImages } from '../exports/archive-images';
import { eventRows } from '../exports/archive-images.fixtures';
import { storagePrefixOf, withStorageTimeout } from './storage-timeout-fetch';

describe('storagePrefixOf: built the way supabase-js builds its storage address', () => {
  it.each([
    ['http://kong:8000', 'http://kong:8000/storage/v1/'],
    ['http://kong:8000/', 'http://kong:8000/storage/v1/'],
    [' https://app.example.test ', 'https://app.example.test/storage/v1/'],
    ['http://host/sb', 'http://host/sb/storage/v1/'],
  ])('%s → %s', (url, prefix) => {
    expect(storagePrefixOf(url)).toBe(prefix);
  });

  it('matches the address the real client calls, a Supabase URL with a path included', () => {
    for (const url of ['http://kong:8000', 'http://host/sb']) {
      const client = createClient(url, 'key');
      expect(`${client.storage.from('b').getPublicUrl('p').data.publicUrl}`).toMatch(
        new RegExp(`^${storagePrefixOf(url).replaceAll('.', '\\.')}`, 'u'),
      );
    }
  });
});

/** An inner fetch that never answers on its own: it rejects only when its signal aborts. */
function hangingFetch() {
  return vi.fn(
    (_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      }),
  );
}

describe('withStorageTimeout', () => {
  const base = 'http://kong:8000';

  it('passes any other address through with the caller options untouched', async () => {
    const answer = new Response('[]');
    const inner = vi.fn(async (_input: string, _init?: RequestInit) => answer);
    const init = { method: 'POST' };
    const wrapped = withStorageTimeout(inner as never, base, 50, { warn: vi.fn() });
    await expect(wrapped(`${base}/rest/v1/events`, init)).resolves.toBe(answer);
    expect(inner).toHaveBeenCalledWith(`${base}/rest/v1/events`, init);
    expect(inner.mock.calls[0]?.[1]).toBe(init);
  });

  it('stops a storage call at the limit and says so once, without the object path', async () => {
    const warn = vi.fn();
    const wrapped = withStorageTimeout(hangingFetch() as never, base, 100, { warn });
    const started = Date.now();
    await expect(
      wrapped(`${base}/storage/v1/object/event-assets/events/e-1/logo.png`, { method: 'POST' }),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(90);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      'Storage gave no answer within 100 ms: POST storage/v1/object',
    );
  });

  it('keeps the caller own abort working, and does not report it as a timeout', async () => {
    const warn = vi.fn();
    const wrapped = withStorageTimeout(hangingFetch() as never, base, 5_000, { warn });
    const caller = new AbortController();
    const call = wrapped(`${base}/storage/v1/object/b/p`, { signal: caller.signal });
    caller.abort(new Error('caller gave up'));
    await expect(call).rejects.toThrow('caller gave up');
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('a storage that never answers, through the real Supabase client', () => {
  let server: Server;
  let url: string;
  const warn = vi.fn();
  /** Every storage request the server received, as `METHOD /path`. */
  const storageCalls: string[] = [];

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url?.startsWith('/rest/v1/')) {
        // Slower than the storage limit: a database read must not be cut by it.
        setTimeout(() => res.writeHead(200, { 'content-type': 'application/json' }).end('[]'), 300);
        return;
      }
      storageCalls.push(`${req.method} ${req.url}`);
      if (req.url === '/storage/v1/bucket/fresh') {
        // What storage answers for a bucket it does not have.
        const body = { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' };
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify(body));
        return;
      }
      if (req.method === 'POST' && req.url === '/storage/v1/bucket') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"name":"fresh"}');
        return;
      }
      if (req.url?.includes('logo-1-fal.png')) {
        // Headers and the first bytes, then nothing: a body that stalls mid-read.
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': '1000' });
        res.write(Buffer.alloc(10));
        return;
      }
      // Any other storage call: the connection is taken and never answered.
      req.resume();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** `limit` is the storage limit in ms; a test that expects storage to answer gives it room. */
  const client = (limit = 100) =>
    createClient(url, 'key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: withStorageTimeout(fetch, url, limit, { warn }) },
    });

  async function within<T>(ms: number, work: PromiseLike<T>): Promise<T> {
    const started = Date.now();
    const result = await work;
    expect(Date.now() - started).toBeLessThan(ms);
    return result;
  }

  it('an upload, a download and a bucket check each give up with an error', async () => {
    warn.mockClear();
    const storage = client().storage;
    const calls: Array<PromiseLike<{ data: unknown; error: unknown }>> = [
      storage.from('event-assets').upload('events/e-1/x.png', Buffer.from('png')),
      storage.from('event-assets').download('events/e-1/x.png'),
      storage.getBucket('event-assets'),
    ];
    for (const call of calls) {
      const { data, error } = await within(2_000, call);
      expect(data).toBeNull();
      expect(storageGaveNoAnswer(error)).toBe(true);
    }
    // Each one said so, with the kind of call and never the object's path. (The upload and
    // the bucket check start at once, the download when awaited: the order is not fixed.)
    expect(warn.mock.calls.map(([line]) => String(line)).sort()).toEqual([
      'Storage gave no answer within 100 ms: GET storage/v1/bucket',
      'Storage gave no answer within 100 ms: GET storage/v1/object',
      'Storage gave no answer within 100 ms: POST storage/v1/object',
    ]);
  });

  it('a bucket storage says it does not have is created; one it gives no answer about is not', async () => {
    storageCalls.length = 0;
    // The answered half has room so a slow machine cannot turn an answer into a timeout.
    await ensurePublicBucket(client(5_000).storage as never, 'fresh', 1024, new Set(['image/png']));
    expect(storageCalls).toEqual(['GET /storage/v1/bucket/fresh', 'POST /storage/v1/bucket']);

    storageCalls.length = 0;
    const refusal = within(
      2_000,
      ensurePublicBucket(client().storage as never, 'hung', 1024, new Set(['image/png'])),
    );
    await expect(refusal).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(storageCalls).toEqual(['GET /storage/v1/bucket/hung']);
  });

  it('a database read slower than the storage limit is not cut', async () => {
    const { data, error } = await client().from('events').select('id');
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('an archive export stops asking a storage that gave no answer, and carries on', async () => {
    storageCalls.length = 0;
    const data = eventRows();
    const { manifest } = await within(
      2_000,
      collectArchiveImages({
        storage: client().storage as never,
        scope: 'event',
        data,
        serialise: (images) => JSON.stringify({ images }),
        otherEntries: [],
        maxZipBytes: 50 * 1024 * 1024,
        maxDataBytes: 25 * 1024 * 1024,
      }),
    );
    const images = (JSON.parse(manifest) as { images: ArchiveImages }).images;
    expect(images.carried).toEqual([]);
    expect(images.leftOut.length).toBeGreaterThan(1);
    expect(new Set(images.leftOut.map((left) => left.reason))).toEqual(new Set(['unreadable']));
    // The first image's body stalled; no other image was asked for.
    expect(storageCalls).toEqual([
      'GET /storage/v1/object/event-assets/events/event-1/logo-1-fal.png',
    ]);
  });
});
