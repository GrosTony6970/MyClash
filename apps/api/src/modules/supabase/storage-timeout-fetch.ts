import { Logger } from '@nestjs/common';
import { methodOf, urlOf } from './query-errors/recording-fetch';

/**
 * How long any storage call may take before the API gives up on it. The API and
 * storage run on the same server and an image is at most 15 MB, so a call this
 * slow is a hung one. Without a limit, a storage service that accepts the
 * connection and never answers holds a logo upload or an archive export forever.
 */
export const STORAGE_TIMEOUT_MS = 30_000;

type FetchInput = Parameters<typeof fetch>[0];
type Warn = Pick<Logger, 'warn'>;

const defaultLogger = new Logger('StorageTimeout');

/**
 * The address every storage call starts with, built the way supabase-js builds
 * it (`validateSupabaseUrl`: trimmed, a trailing slash added, then
 * `new URL('storage/v1', base)`), so a Supabase URL with a path still matches.
 */
export function storagePrefixOf(supabaseUrl: string): string {
  const base = supabaseUrl.trim();
  return new URL('storage/v1/', base.endsWith('/') ? base : `${base}/`).href;
}

/**
 * Wraps the Supabase clients' `fetch` so a storage call gives up after `ms`.
 * storage-js lets a caller pass an abort signal to a download, but not to an
 * upload or a bucket check, so the limit lives here, under every one of them.
 * Any other address (PostgREST, auth) passes through with the caller's options
 * untouched. supabase-js passes the address as a string and its options, its
 * signal included, in `init`: a signal there still works, either one aborts.
 *
 * When the limit stopped a call before its answer began, one warning names the
 * method and the kind of call (`storage/v1/object`, `…/bucket`), never the
 * object's path: an upload turns the error into a 503 or a 400, and the archive
 * leaves the image out, but neither says that time ran out. A body that stalls
 * after its headers arrived is aborted too, but fails in the caller's read, after
 * this function has returned, so it leaves no warning here.
 */
export function withStorageTimeout(
  inner: typeof fetch,
  supabaseUrl: string,
  ms: number,
  logger: Warn = defaultLogger,
): typeof fetch {
  const prefix = storagePrefixOf(supabaseUrl);
  return async function storageTimeoutFetch(input: FetchInput, init?: RequestInit) {
    const url = urlOf(input);
    if (!url.startsWith(prefix)) return inner(input, init);

    const limit = AbortSignal.timeout(ms);
    const own = init?.signal;
    const signal = own ? AbortSignal.any([own, limit]) : limit;
    try {
      return await inner(input, { ...init, signal });
    } catch (error) {
      if (limit.aborted && !own?.aborted) {
        const kind = url.slice(prefix.length).split(/[/?#]/u)[0] || '(root)';
        logger.warn(
          `Storage gave no answer within ${ms} ms: ${methodOf(input, init)} storage/v1/${kind}`,
        );
      }
      throw error;
    }
  };
}
