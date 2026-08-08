/**
 * One answer to "how fresh is what I am looking at?".
 *
 * Three implementations of this question existed, and they disagreed:
 *
 *   - `useLiveMatch` exposed a boolean `connected`, starting FALSE, with no
 *     grace period and no knowledge of the kill-switch.
 *   - `use-match-live-channel` exposed `connected` starting TRUE plus a derived
 *     `degraded`, and treated a working poll as degraded on purpose.
 *   - `useRealtimeWithFallback` (forked between web-admin and web-public)
 *     exposed NOTHING — it logged to the console and returned void.
 *
 * The disagreement that mattered was not the plumbing, it was the POLICY. The
 * TV scoreboard treats a working poll as live ("a polling surface should be
 * treated as connected"); the public match page treats the same poll as
 * degraded ("this reports updates are slower, not updates have stopped"). Both
 * are right about their own audience, and a boolean cannot hold both.
 *
 * So this is not a boolean. `polling` is its own state, distinct from `stale`:
 *
 *   live     — pushes are arriving. Nothing to say.
 *   polling  — the socket is down but refetches are landing. SLOWER, not
 *              broken. A projector can stay quiet; a spectator page can say so.
 *   stale    — nothing has landed in several poll intervals. This is the state
 *              that earned the whole slice: a dead websocket polling happily
 *              looked perfectly healthy for weeks.
 *   disabled — the operator flipped `disable_realtime`. Deliberately its own
 *              reason rather than folded into `polling`, because "we turned it
 *              off" and "it broke" need different words at 09:00 on a Saturday.
 *
 * Pure: no React, no I/O, no clock of its own. `now` is a parameter so the
 * transitions are testable without faking timers.
 */

export type FreshnessKind = 'live' | 'polling' | 'stale' | 'disabled';

export interface Freshness {
  kind: FreshnessKind;
  /** Poll cadence in ms. Set for `polling` and `disabled`. */
  pollMs?: number;
  /** Time since the last successful update, ms. Set for `stale`. */
  ageMs?: number;
}

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
 */
export function fallbackPollMs({ status, visible }: FallbackPollInput): number {
  if (!visible) return IDLE_POLL_MS;
  return LIVE_STATUSES.has(status) ? LIVE_POLL_MS : IDLE_POLL_MS;
}

/**
 * Whether a Supabase channel status means "we are no longer receiving pushes,
 * start polling".
 *
 * `SUBSCRIBED` is the only status that stops the poll; anything else
 * (`JOINING`, and any status a future supabase-js adds) leaves the current
 * behaviour untouched rather than thrashing the timer on a transient state.
 */
export function shouldStartFallbackPoll(status: string): boolean {
  return status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT';
}

/**
 * How many missed poll intervals before a surface counts as stale rather than
 * merely slow.
 *
 * Three, not one. A single missed interval is a slow response on venue wifi,
 * which is normal and not worth alarming about; three in a row means the poll
 * itself is not landing, which is the condition nothing used to report.
 */
const STALE_INTERVALS = 3;

export interface FreshnessInput {
  /** `disable_realtime`, from the public flags snapshot. */
  realtimeDisabled: boolean;
  /**
   * The channel's last reported status, or null when no channel was opened
   * (kill-switch, or a surface that only polls).
   */
  channelStatus: string | null;
  /** Current fallback cadence, 0 or undefined when nothing is polling. */
  pollMs: number | undefined;
  /** When data last successfully arrived, epoch ms. Null before the first load. */
  lastUpdateAt: number | null;
  now: number;
}

/**
 * Decide the freshness state.
 *
 * Order matters and encodes the priority of what a viewer needs to know:
 * an operator-flipped kill-switch explains everything else, a live channel
 * needs no further checks, and staleness is only meaningful once something is
 * supposed to be arriving.
 */
export function deriveFreshness(input: FreshnessInput): Freshness {
  const { realtimeDisabled, channelStatus, pollMs, lastUpdateAt, now } = input;

  if (realtimeDisabled) return { kind: 'disabled', pollMs: pollMs || IDLE_POLL_MS };
  if (channelStatus === 'SUBSCRIBED') return { kind: 'live' };

  // Before the first payload lands there is nothing to be stale about — a page
  // one second into its initial load is not a broken page.
  if (lastUpdateAt === null) {
    return pollMs ? { kind: 'polling', pollMs } : { kind: 'live' };
  }

  const ageMs = Math.max(0, now - lastUpdateAt);
  const budget = (pollMs || IDLE_POLL_MS) * STALE_INTERVALS;
  if (ageMs > budget) return { kind: 'stale', ageMs };

  // A channel that has never reported anything yet (null status, no poll) is
  // still joining. Saying "stale" there would flash on every page load.
  return pollMs ? { kind: 'polling', pollMs } : { kind: 'live' };
}

/**
 * Does this state deserve the viewer's attention?
 *
 * The one place the TV-vs-spectator disagreement is resolved: a working poll is
 * NOT an alarm anywhere, it is just slower. Only a surface that has actually
 * stopped updating — or one the operator has switched off — is worth a badge on
 * an unattended projector.
 */
export function isFreshnessAlarming(freshness: Freshness): boolean {
  return freshness.kind === 'stale' || freshness.kind === 'disabled';
}
