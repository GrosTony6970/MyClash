/**
 * Whether a storage call got no answer at all: storage is down, or the storage timeout
 * (modules/supabase/storage-timeout-fetch.ts) stopped it. storage-js returns what storage
 * answered (a 404, a 413) as a StorageApiError; no answer comes back in `{ error }` as a
 * StorageUnknownError, or, for a body that stalls mid-read, is thrown as a TimeoutError.
 * Read by name, so a second copy of the library cannot defeat an `instanceof`.
 *
 * Anything else (a body cut mid-read, `TypeError: terminated`) is about that one object.
 * A loop over many objects stops asking after the first "no answer": each further call
 * would wait out the whole limit again. storage-js also returns a StorageUnknownError for a
 * connection reset or a 2xx body that is not JSON, so one such hiccup ends the loop too; what
 * is skipped is still reported (an image left out, an old link kept), never lost.
 */
export function storageGaveNoAnswer(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'StorageUnknownError' || error.name === 'TimeoutError';
}
