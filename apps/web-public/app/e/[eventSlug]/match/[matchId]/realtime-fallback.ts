/**
 * How long the match page waits between refetches while its realtime channel is
 * down. Two speeds, because the cost of polling is paid by the venue, not by the
 * browser.
 *
 * The API's throttler keys on the real client IP (Fastify runs with
 * `trustProxy: 1`), and every phone on a hall's wifi shares ONE public address —
 * so a room draws on a single bucket. The three polled endpoints therefore carry
 * PUBLIC_LIVE_READ_THROTTLE (600/min) rather than the global 120/min: at the
 * live cadence below that is 36 req/min per spectator, i.e. a ceiling around
 * sixteen phones instead of three.
 *
 * Spend that budget only where it shows. A running bout scores every few
 * seconds and a spectator is watching the number change; a scheduled or paused
 * one, or a page sitting in a backgrounded tab, changes nothing a spectator is
 * waiting on.
 */
export const LIVE_POLL_MS = 5_000;
export const IDLE_POLL_MS = 30_000;

/** Statuses whose scoreboard can change from one second to the next. */
const LIVE_STATUSES = new Set(['running']);

export interface FallbackPollInput {
  /** `matches.status`. */
  status: string;
  /** `document.visibilityState === 'visible'`. */
  visible: boolean;
}

/**
 * The refetch interval to use while degraded.
 *
 * A hidden tab always polls slowly regardless of status: nobody is reading it,
 * and a phone in a pocket left on a running bout is exactly the case that
 * multiplies into the throttle ceiling. Browsers already throttle timers in
 * background tabs, but by an amount that varies per engine — this makes the
 * floor ours rather than theirs.
 *
 * Pure: no React, no I/O.
 */
export function fallbackPollMs({ status, visible }: FallbackPollInput): number {
  if (!visible) return IDLE_POLL_MS;
  return LIVE_STATUSES.has(status) ? LIVE_POLL_MS : IDLE_POLL_MS;
}

/**
 * Whether a Supabase channel status means "we are no longer receiving pushes,
 * start polling". The three terminal statuses are the same set `useLiveMatch`
 * and `useRealtimeWithFallback` treat as degraded.
 *
 * `SUBSCRIBED` is the only status that stops the poll; anything else
 * (`JOINING`, and any status a future supabase-js adds) leaves the current
 * behaviour untouched rather than thrashing the timer on a transient state.
 *
 * Pure: no React, no I/O.
 */
export function shouldStartFallbackPoll(status: string): boolean {
  return status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT';
}
