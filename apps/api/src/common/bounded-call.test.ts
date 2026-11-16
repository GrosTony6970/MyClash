import { describe, expect, it } from 'vitest';
import { boundedCall, BoundedCallTimeout } from './bounded-call';

describe('boundedCall', () => {
  it('gives up at its bound and aborts the call, even when the call ignores the signal', async () => {
    let aborted = false;
    const started = Date.now();
    const gaveUp = boundedCall(
      (signal) => {
        signal.addEventListener('abort', () => (aborted = true));
        return new Promise(() => {});
      },
      30,
      (ms) => `nothing within ${ms} ms`,
    );
    await expect(gaveUp).rejects.toThrow('nothing within 30 ms');
    await expect(gaveUp).rejects.toBeInstanceOf(BoundedCallTimeout);
    expect(aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('passes the answer and the error of a call that settles in time', async () => {
    const never = () => 'unused';
    await expect(boundedCall(async () => 'ok', 1_000, never)).resolves.toBe('ok');
    const failed = boundedCall(async () => Promise.reject(new Error('HTTP 500')), 1_000, never);
    await expect(failed).rejects.toThrow('HTTP 500');
    await expect(failed).rejects.not.toBeInstanceOf(BoundedCallTimeout);
  });
});
