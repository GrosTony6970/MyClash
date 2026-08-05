import { describe, expect, it } from 'vitest';
import { FALLBACK_POLL_MS, shouldStartFallbackPoll } from './realtime-fallback';

describe('shouldStartFallbackPoll', () => {
  it('starts polling on every terminal status', () => {
    expect(shouldStartFallbackPoll('CLOSED')).toBe(true);
    expect(shouldStartFallbackPoll('CHANNEL_ERROR')).toBe(true);
    expect(shouldStartFallbackPoll('TIMED_OUT')).toBe(true);
  });

  it('does not poll while subscribed', () => {
    expect(shouldStartFallbackPoll('SUBSCRIBED')).toBe(false);
  });

  it('leaves transient statuses alone rather than thrashing the timer', () => {
    expect(shouldStartFallbackPoll('JOINING')).toBe(false);
    expect(shouldStartFallbackPoll('SOMETHING_NEW')).toBe(false);
  });
});

describe('FALLBACK_POLL_MS', () => {
  // The venue-NAT throttling budget documented on the constant only holds at
  // 30s or slower: 120 req/min per IP ÷ 3 requests per poll ÷ 2 polls per
  // minute ≈ 20 spectators sharing one public IP. Halving this halves that.
  it('is no faster than 30s', () => {
    expect(FALLBACK_POLL_MS).toBeGreaterThanOrEqual(30_000);
  });
});
