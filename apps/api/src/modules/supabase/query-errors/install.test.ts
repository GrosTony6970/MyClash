import { describe, expect, it, vi } from 'vitest';
import type * as TimerModule from '../storage-timeout-fetch';
import { STORAGE_TIMEOUT_MS } from '../storage-timeout-fetch';
import { createInstrumentedClients } from './install';

/**
 * Both API clients send their storage calls through the storage timer, at
 * STORAGE_TIMEOUT_MS. The timer's own tests prove it stops a call; this proves
 * the clients the API really uses are built with it: deleting the wrap from
 * install.ts leaves those tests green and this one red.
 */

const seen = vi.hoisted(() => ({
  wraps: [] as Array<{ url: string; ms: number }>,
  calls: [] as string[],
}));

vi.mock('../storage-timeout-fetch', async (importOriginal) => {
  const real = await importOriginal<typeof TimerModule>();
  return {
    ...real,
    withStorageTimeout: (_inner: typeof fetch, url: string, ms: number) => {
      seen.wraps.push({ url, ms });
      return async (input: Parameters<typeof fetch>[0]) => {
        seen.calls.push(String(input));
        return new Response(JSON.stringify({ id: 'b', name: 'b' }), {
          headers: { 'content-type': 'application/json' },
        });
      };
    },
  };
});

describe('createInstrumentedClients', () => {
  it('builds both clients on the storage timer, at the shared limit', async () => {
    const clients = createInstrumentedClients('http://kong:8000', 'anon-key', 'service-key');
    expect(STORAGE_TIMEOUT_MS).toBe(30_000);
    expect(seen.wraps).toEqual([{ url: 'http://kong:8000', ms: STORAGE_TIMEOUT_MS }]);

    await clients.service.storage.getBucket('b');
    await clients.anon.storage.getBucket('b');
    expect(seen.calls).toEqual([
      'http://kong:8000/storage/v1/bucket/b',
      'http://kong:8000/storage/v1/bucket/b',
    ]);
  });
});
