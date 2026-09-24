import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOGIN_KEEP_ALIVE_MS, startLoginKeepAlive } from './useLoginKeepAlive';

const API = 'https://api.example.test';

describe('startLoginKeepAlive — a display screen stays signed in all day', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('asks /me at once, with the login cookie, never from a cache', () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('{}')));
    const stop = startLoginKeepAlive(API, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(`${API}/api/v1/me`, {
      credentials: 'include',
      cache: 'no-store',
    });
    stop();
  });

  it('asks again every minute — well inside the five minutes /me renews within', () => {
    expect(LOGIN_KEEP_ALIVE_MS).toBe(60_000);
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('{}')));
    const stop = startLoginKeepAlive(API, fetchImpl);

    vi.advanceTimersByTime(LOGIN_KEEP_ALIVE_MS - 1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(LOGIN_KEEP_ALIVE_MS * 3);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    stop();
  });

  it('stops when the screen leaves the page', () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('{}')));
    startLoginKeepAlive(API, fetchImpl)();

    vi.advanceTimersByTime(LOGIN_KEEP_ALIVE_MS * 5);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps asking after a failed call: the wifi dropping once must not end it', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValue(new Response('{}'));
    const stop = startLoginKeepAlive(API, fetchImpl as never);
    await vi.advanceTimersByTimeAsync(LOGIN_KEEP_ALIVE_MS);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    stop();
  });
});
