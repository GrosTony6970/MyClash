// Time-aware classification of a personal-schedule commitment into
// past | live | upcoming, so the Schedule view can mark the item that's happening
// now (LIVE) and the first genuinely upcoming one (NEXT) against the real clock —
// not just by list order.

export type TemporalState = 'past' | 'live' | 'upcoming';

export interface TimeInput {
  kind: 'fight' | 'referee' | 'workshop';
  /** Scheduled start (epoch ms), or null/NaN when the time is TBD. */
  startMs: number | null;
  /** The planned end (epoch ms). Null when unknown: the item is then past as soon as it starts. */
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
 * no status, so they're classified purely by their time window. An item whose end
 * is unknown (a sheet the API could not read) has no window to be live in: it is
 * past once it has started. TBD items (no start) are treated as `upcoming` — they
 * sort last, so they only become NEXT when nothing else is upcoming.
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
    // Fall through to the window rule below: the fight is LIVE for its planned
    // length, so exactly one fight is LIVE at a given simulated minute.
  }

  const start = input.startMs;
  if (start == null || Number.isNaN(start)) return 'upcoming';
  const end = input.endMs != null && !Number.isNaN(input.endMs) ? input.endMs : start;
  if (now >= end) return 'past';
  if (now >= start) return 'live';
  return 'upcoming';
}
