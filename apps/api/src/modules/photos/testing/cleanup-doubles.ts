/**
 * The doubles of the photo clean-up tests (photo-cleanup.test.ts, photo-cleanup.sweep.test.ts):
 * ids, a logger, a clean-up over a mocked database, and an in-memory bucket. Test-only; excluded
 * from the build (tsconfig.build.json).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';
import { type ChainResult, type mockSupabase } from '../../../common/testing/supabase-chain';
import type { PhotoStore } from '../photo-bucket';
import { PhotoCleanup } from '../photo-cleanup';

export const E1 = '11111111-1111-4111-8111-111111111111';
export const E2 = '22222222-2222-4222-8222-222222222222';
export const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const key = (event: string, photo: string, kind: 'original' | 'preview') =>
  `events/${event}/${photo}/${kind}.jpg`;

export const logger = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });
export const ok = (data: unknown): ChainResult => ({ data, error: null });
export const cleanup = (
  supabase: ReturnType<typeof mockSupabase>,
  store: PhotoStore | null,
  log = logger(),
  now = () => Date.parse('2026-07-01T12:00:00Z'),
) => new PhotoCleanup(supabase.service as unknown as SupabaseClient, store, log, now);

/**
 * An in-memory bucket. `failOn` refuses one key; `pageSize` splits the listing; `undated` is the
 * count of entries each page reports it could not judge.
 */
export function memoryStore(
  objects: Record<string, Date> = {},
  opts: {
    failOn?: string;
    pageSize?: number;
    onRemove?: (key: string) => void;
    undated?: number;
  } = {},
) {
  const keys = new Map(Object.entries(objects));
  const removed: string[] = [];
  const lists: Array<[string, string | undefined]> = [];
  const store: PhotoStore = {
    put: async () => {},
    remove: async (k) => {
      opts.onRemove?.(k);
      if (k === opts.failOn)
        throw new Error('Photo bucket did not answer within 10000 ms (delete)');
      keys.delete(k);
      removed.push(k);
    },
    list: async (prefix, next) => {
      lists.push([prefix, next]);
      // Paged by key, as S3's continuation token is: a delete between pages shifts nothing.
      const all = [...keys]
        .filter(([k]) => k.startsWith(prefix) && (next === undefined || k > next))
        .sort(([a], [b]) => a.localeCompare(b));
      const page = all.slice(0, opts.pageSize ?? 1000);
      return {
        objects: page.map(([k, lastModified]) => ({ key: k, lastModified })),
        next: all.length > page.length ? page.at(-1)?.[0] : undefined,
        undated: opts.undated ?? 0,
      };
    },
    link: async () => {
      throw new Error('the clean-up never signs a link');
    },
  };
  return { store, removed, lists };
}
