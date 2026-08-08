import { describe, expect, it } from 'vitest';
import {
  deriveFreshness,
  fallbackPollMs,
  IDLE_POLL_MS,
  isFreshnessAlarming,
  LIVE_POLL_MS,
  shouldStartFallbackPoll,
  type FreshnessInput,
} from './realtime-freshness';

const NOW = 1_700_000_000_000;

function input(overrides: Partial<FreshnessInput> = {}): FreshnessInput {
  return {
    realtimeDisabled: false,
    channelStatus: 'SUBSCRIBED',
    pollMs: undefined,
    lastUpdateAt: NOW,
    now: NOW,
    ...overrides,
  };
}

describe('fallbackPollMs', () => {
  it('polls fast for a running bout in a visible tab', () => {
    expect(fallbackPollMs({ status: 'running', visible: true })).toBe(LIVE_POLL_MS);
  });

  it('polls slowly for anything that is not running', () => {
    expect(fallbackPollMs({ status: 'scheduled', visible: true })).toBe(IDLE_POLL_MS);
    expect(fallbackPollMs({ status: 'completed', visible: true })).toBe(IDLE_POLL_MS);
  });

  it('polls slowly in a hidden tab even for a running bout', () => {
    // A phone in a pocket left on a running bout is exactly the case that
    // multiplies into the venue's shared throttle bucket.
    expect(fallbackPollMs({ status: 'running', visible: false })).toBe(IDLE_POLL_MS);
  });
});

describe('shouldStartFallbackPoll', () => {
  it.each(['CLOSED', 'CHANNEL_ERROR', 'TIMED_OUT'])('starts polling on %s', (status) => {
    expect(shouldStartFallbackPoll(status)).toBe(true);
  });

  it('does not poll on SUBSCRIBED', () => {
    expect(shouldStartFallbackPoll('SUBSCRIBED')).toBe(false);
  });

  it('leaves a transient status alone rather than thrashing the timer', () => {
    expect(shouldStartFallbackPoll('JOINING')).toBe(false);
    expect(shouldStartFallbackPoll('SOMETHING_NEW')).toBe(false);
  });
});

describe('deriveFreshness', () => {
  it('is live while the channel is subscribed', () => {
    expect(deriveFreshness(input())).toEqual({ kind: 'live' });
  });

  it('reports the kill-switch as its own reason, not as polling', () => {
    // "We turned it off" and "it broke" need different words at 09:00 on a
    // Saturday.
    expect(deriveFreshness(input({ realtimeDisabled: true, pollMs: 30_000 }))).toEqual({
      kind: 'disabled',
      pollMs: 30_000,
    });
  });

  it('reports the kill-switch even while the channel claims to be subscribed', () => {
    // The flag is polled every 60s, so a channel opened before the flip is
    // still reporting SUBSCRIBED. The operator's intent wins.
    expect(deriveFreshness(input({ realtimeDisabled: true }))).toMatchObject({
      kind: 'disabled',
    });
  });

  it('is POLLING, not stale, while refetches are landing', () => {
    // The distinction the whole module exists for: slower is not broken.
    expect(
      deriveFreshness(
        input({ channelStatus: 'CHANNEL_ERROR', pollMs: 5_000, lastUpdateAt: NOW - 4_000 }),
      ),
    ).toEqual({ kind: 'polling', pollMs: 5_000 });
  });

  it('goes stale once nothing has landed for three poll intervals', () => {
    // A dead websocket polling happily looked perfectly healthy for weeks.
    // This is the state that would have said so.
    const freshness = deriveFreshness(
      input({ channelStatus: 'CHANNEL_ERROR', pollMs: 5_000, lastUpdateAt: NOW - 15_001 }),
    );
    expect(freshness.kind).toBe('stale');
    expect(freshness.ageMs).toBe(15_001);
  });

  it('tolerates one missed interval — venue wifi is slow, not broken', () => {
    expect(
      deriveFreshness(
        input({ channelStatus: 'CHANNEL_ERROR', pollMs: 5_000, lastUpdateAt: NOW - 6_000 }),
      ).kind,
    ).toBe('polling');
  });

  it('never reports stale before the first payload has landed', () => {
    // A page one second into its initial load is not a broken page.
    expect(
      deriveFreshness({
        realtimeDisabled: false,
        channelStatus: null,
        pollMs: 5_000,
        lastUpdateAt: null,
        now: NOW,
      }),
    ).toEqual({ kind: 'polling', pollMs: 5_000 });
  });

  it('treats a joining channel as live rather than flashing on every load', () => {
    expect(
      deriveFreshness(input({ channelStatus: null, pollMs: undefined, lastUpdateAt: null })),
    ).toEqual({ kind: 'live' });
  });

  it('uses the idle cadence as the stale budget when nothing is polling', () => {
    const stale = deriveFreshness(
      input({ channelStatus: 'CLOSED', pollMs: undefined, lastUpdateAt: NOW - 90_001 }),
    );
    expect(stale.kind).toBe('stale');
  });

  it('clamps a clock that has gone backwards to zero rather than reporting negative age', () => {
    expect(
      deriveFreshness(input({ channelStatus: 'CLOSED', lastUpdateAt: NOW + 5_000 })).kind,
    ).toBe('live');
  });
});

describe('isFreshnessAlarming', () => {
  it('never alarms on a working poll — that is the TV-vs-spectator ruling', () => {
    expect(isFreshnessAlarming({ kind: 'polling', pollMs: 5_000 })).toBe(false);
  });

  it('does not alarm on live', () => {
    expect(isFreshnessAlarming({ kind: 'live' })).toBe(false);
  });

  it('alarms on stale and on the kill-switch', () => {
    expect(isFreshnessAlarming({ kind: 'stale', ageMs: 60_000 })).toBe(true);
    expect(isFreshnessAlarming({ kind: 'disabled', pollMs: 30_000 })).toBe(true);
  });
});
