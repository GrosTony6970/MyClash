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
 */
export function classifyTime(input: TimeInput, now: number): TemporalState {
  if (input.kind === 'fight') {
    if (input.status === 'completed') return 'past';
    if (input.status === 'running') return 'live';
    return 'upcoming';
  }

  const start = input.startMs;
  if (start == null || Number.isNaN(start)) return 'upcoming';
  const end =
    input.endMs != null && !Number.isNaN(input.endMs) ? input.endMs : start + DEFAULT_DURATION_MS;
  if (now >= end) return 'past';
  if (now >= start) return 'live';
  return 'upcoming';
}
