import { crc32 } from 'node:zlib';
import type { PhotoStore } from '../photo-bucket';
import type { DownloadRow } from '../photo-download';

/** A stored photo's row, its original being `bytes`; the size and CRC are those of `bytes`. */
export function downloadRow(
  n: number,
  bytes: Buffer,
  extra: Partial<DownloadRow> = {},
): DownloadRow {
  const hex = n.toString(16).padStart(8, '0');
  return {
    id: `${hex}-0000-4000-8000-000000000000`,
    status: 'approved',
    uploader_name: `Sender ${n}`,
    caption: null,
    created_at: `2026-11-01T13:${String(n % 60).padStart(2, '0')}:00+00:00`,
    original_key: `events/e/${hex}/original.jpg`,
    byte_size: bytes.length,
    crc32: crc32(bytes),
    tournament: null,
    workshop: null,
    ...extra,
  };
}

type Answer = Buffer | null | Error;

/**
 * A store whose reads a test can hold: each `get` waits until the test releases it (or answers
 * at once from `answers` when `auto` is set). It counts the reads started.
 */
export function heldStore(answers: Record<string, Answer>, { auto = false } = {}) {
  const started: string[] = [];
  const pending: Array<{ key: string; release: () => void }> = [];
  const answer = (key: string): Buffer | null => {
    const value = answers[key];
    if (value instanceof Error) throw value;
    if (value === undefined) throw new Error(`the test never stored ${key}`);
    return value;
  };
  const store: PhotoStore = {
    get: (key) => {
      started.push(key);
      if (auto) return Promise.resolve().then(() => answer(key));
      return new Promise((resolve, reject) => {
        pending.push({
          key,
          release: () => {
            try {
              resolve(answer(key));
            } catch (err) {
              reject(err as Error);
            }
          },
        });
      });
    },
    put: async () => {
      throw new Error('the download never writes');
    },
    remove: async () => {
      throw new Error('the download never deletes');
    },
    list: async () => {
      throw new Error('the download never lists');
    },
    link: async () => {
      throw new Error('the download never signs a link');
    },
  };
  /** Releases the oldest held read. */
  const releaseNext = () => pending.shift()!.release();
  return { store, started, releaseNext, held: () => pending.length };
}

/** Lets every queued task and timer of this turn run. */
export const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
