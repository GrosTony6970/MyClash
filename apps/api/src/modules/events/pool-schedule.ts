/**
 * Derive a pool's lice + start time from its matches, for the public Pool
 * List. A pool runs on one lice; the public pool-list card groups pools by
 * their start time and shows the lice as a per-card badge. The grouping key
 * is the start only (end time is intentionally ignored).
 */

export interface PoolMatchTimeRow {
  scheduled_at: string | null;
  lices: { name: string | null; color_hex: string | null } | null;
}

export interface PoolScheduleInfo {
  liceName: string | null;
  liceColorHex: string | null;
  /** Earliest scheduled match — the pool's start, used as the grouping key. */
  startAt: string | null;
}

export function derivePoolSchedule(matches: PoolMatchTimeRow[]): PoolScheduleInfo {
  const scheduled = matches
    .filter((m): m is PoolMatchTimeRow & { scheduled_at: string } => Boolean(m.scheduled_at))
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));

  const startAt = scheduled[0]?.scheduled_at ?? null;
  // Prefer the earliest match's lice; if it has none, use the first scheduled
  // match that does (pools normally run on a single lice anyway).
  const liceRow = scheduled.find((m) => m.lices)?.lices ?? null;

  return {
    liceName: liceRow?.name ?? null,
    liceColorHex: liceRow?.color_hex ?? null,
    startAt,
  };
}
