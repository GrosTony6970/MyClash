// Time-aware classification of a personal-schedule commitment into
// past | live | upcoming, so the Schedule view can mark the item that's happening
// now (LIVE) and the first genuinely upcoming one (NEXT) against the real clock —
// not just by list order.

import { DEFAULT_DURATION_MS } from './conflicts';

export type TemporalState = 'past' | 'live' | 'upcoming';

export interface TimeInput {
  kind: 'fight' | 'referee' | 'workshop';
  /** Scheduled start (epoch ms), or null/NaN when the time is TBD. */
  startMs: number | null;
  /** Explicit end (epoch ms) — workshops only; null falls back to start + default. */
  endMs?: number | null;
  /** Server match status — fights only ('scheduled' | 'running' | 'completed' | …). */
  status?: string;
}

/**
 * Classify a commitment relative to `now` (epoch ms).
 *
 * Fights follow their server `status` (source of truth: a bout can start late or
 * run long, so wall-clock start isn't reliable) — a scheduled fight stays
 * `upcoming` even once its slot time has passed. Workshops and referee slots have
 * no status, so they're classified purely by their time window; referee slots have
 * no stored end and reuse the project's 5-minute default. TBD items (no start) are
 * treated as `upcoming` — they sort last, so they only become NEXT when nothing
 * else is upcoming.
 *
 * `simulated` marks `now` as coming from the super-admin time simulation rather
 * than the wall clock. Match statuses are still real, so they'd describe a moment
 * hours away from the simulated one: a *scheduled* fight then falls back to its
 * slot window like a workshop, which is what makes LIVE / NEXT move while
 * simulating. `completed` and `running` remain hard facts and still win.
 */
export function classifyTime(input: TimeInput, now: number, simulated = false): TemporalState {
  if (input.kind === 'fight') {
    if (input.status === 'completed') return 'past';
    if (input.status === 'running') return 'live';
    if (!simulated) return 'upcoming';
    // Fall through to the window rule below (no endMs → start + default duration,
    // so exactly one fight is LIVE at a given simulated minute).
  }

  const start = input.startMs;
  if (start == null || Number.isNaN(start)) return 'upcoming';
  const end =
    input.endMs != null && !Number.isNaN(input.endMs) ? input.endMs : start + DEFAULT_DURATION_MS;
  if (now >= end) return 'past';
  if (now >= start) return 'live';
  return 'upcoming';
}
