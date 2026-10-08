/**
 * Hold a piece of work that talks to the server to a time limit: past it, the
 * work is told to stop (its requests carry the signal) and `late` is the answer.
 *
 * A timer of its own, not only a signal on the request: a request answered 401
 * renews the login through a read that has no limit.
 */
export async function heldTo<T>(
  ms: number,
  work: (signal: AbortSignal) => Promise<T>,
  late: T,
): Promise<T> {
  const stop = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      stop.abort();
      resolve(late);
    }, ms);
  });
  try {
    return await Promise.race([work(stop.signal), limit]);
  } finally {
    clearTimeout(timer);
  }
}

/** A dead wifi must not hold the pad: past this, the server could not be asked. */
export const SERVER_LIMIT_MS = 4000;
