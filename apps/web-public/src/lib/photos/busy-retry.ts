import { failureCode, type ApiResult } from '@myclash/api-client';

/**
 * A photo the API was too busy to take (`photos_busy`: its 4 processing slots are full) is sent
 * again on its own after a short pause (design, "The uploader"). Twenty phones told "busy" at
 * once must not all come back at the same instant, so each pause is jittered.
 */

/** Sends after the first one, at most. Worst case the pauses add up to about 70 s. */
export const BUSY_RETRIES = 5;

/** The pause before send `attempt + 2`: 2 s doubling, capped at 16 s, times 0.5 to 1.5. */
export function busyDelayMs(attempt: number, random: () => number): number {
  return Math.min(16_000, 2_000 * 2 ** attempt) * (0.5 + random());
}

export async function sendRetryingBusy<T>(
  send: () => Promise<ApiResult<T>>,
  opts: {
    wait: (ms: number) => Promise<void>;
    random: () => number;
    onBusy: (attempt: number) => void;
  },
): Promise<ApiResult<T>> {
  let result = await send();
  for (let attempt = 0; attempt < BUSY_RETRIES; attempt += 1) {
    if (result.ok || failureCode(result) !== 'photos_busy') return result;
    opts.onBusy(attempt);
    await opts.wait(busyDelayMs(attempt, opts.random));
    result = await send();
  }
  return result;
}
