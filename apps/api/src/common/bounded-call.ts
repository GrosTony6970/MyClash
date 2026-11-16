/**
 * A call that gave up at its bound. A class of its own, so a caller tells a timeout from any other
 * failure by `instanceof`, not by its text. Not named `TimeoutError`: `storage-answer.ts` and
 * `ops-runner-client.ts` sort errors by that name.
 */
export class BoundedCallTimeout extends Error {
  override name = 'BoundedCallTimeout';
}

/**
 * Runs `call` with an abort signal and gives up at `ms`, whether or not the call honours the
 * signal: an SDK's retries can outlast its connection timeout, and a Redis command waits forever
 * on a client whose `maxRetriesPerRequest` is null, so a signal alone is not a bound. At the bound
 * the signal is aborted and a `BoundedCallTimeout` carries `describe(ms)`; a call that ignores the
 * signal keeps running and settles later, unseen.
 */
export async function boundedCall<T>(
  call: (signal: AbortSignal) => Promise<T>,
  ms: number,
  describe: (ms: number) => string,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gaveUp = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new BoundedCallTimeout(describe(ms)));
    }, ms);
  });
  try {
    return await Promise.race([call(controller.signal), gaveUp]);
  } finally {
    clearTimeout(timer);
  }
}
