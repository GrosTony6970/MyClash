/**
 * How long the match page waits between fallback refetches while its realtime
 * channel is down.
 *
 * 30s is a floor, not a starting point to tune down. The API's global throttler
 * allows 120 req/min keyed on the real client IP (Fastify runs with
 * `trustProxy: 1`), and a venue full of spectators shares ONE public IP behind
 * the wifi NAT. At three requests per poll that is ~20 phones on a shared IP
 * before the whole venue starts collecting 429s — which would be a worse outage
 * than the stale scoreboard this fallback exists to prevent.
 */
export const FALLBACK_POLL_MS = 30_000;

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
