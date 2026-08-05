import { describe, expect, it } from 'vitest';
import {
  IDLE_POLL_MS,
  LIVE_POLL_MS,
  fallbackPollMs,
  shouldStartFallbackPoll,
} from './realtime-fallback';

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

describe('fallbackPollMs', () => {
  it('polls fast for a visible running bout — the only case a spectator waits on', () => {
    expect(fallbackPollMs({ status: 'running', visible: true })).toBe(LIVE_POLL_MS);
  });

  it('polls slowly for a bout that cannot score', () => {
    expect(fallbackPollMs({ status: 'scheduled', visible: true })).toBe(IDLE_POLL_MS);
    expect(fallbackPollMs({ status: 'paused', visible: true })).toBe(IDLE_POLL_MS);
    expect(fallbackPollMs({ status: 'completed', visible: true })).toBe(IDLE_POLL_MS);
    expect(fallbackPollMs({ status: 'voided', visible: true })).toBe(IDLE_POLL_MS);
  });

  // A phone in a pocket left on a running bout is exactly what multiplies into
  // the shared-IP throttle ceiling, so hidden always wins over status.
  it('polls slowly whenever the tab is hidden, running or not', () => {
    expect(fallbackPollMs({ status: 'running', visible: false })).toBe(IDLE_POLL_MS);
    expect(fallbackPollMs({ status: 'scheduled', visible: false })).toBe(IDLE_POLL_MS);
  });
});

describe('poll budget', () => {
  // 3 requests per poll against PUBLIC_LIVE_READ_THROTTLE's 600/min per IP, and
  // a venue shares ONE public IP. If the live cadence drops below 5s, or the
  // profile is lowered, the ceiling falls under ~16 concurrent spectators.
  it('keeps the live cadence within the venue budget', () => {
    const requestsPerPoll = 3;
    const perMinutePerClient = (60_000 / LIVE_POLL_MS) * requestsPerPoll;
    expect(Math.floor(600 / perMinutePerClient)).toBeGreaterThanOrEqual(16);
  });

  it('keeps the idle cadence cheap', () => {
    expect(IDLE_POLL_MS).toBeGreaterThanOrEqual(30_000);
  });
});
