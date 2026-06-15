/**
 * Pure "move a pool" math: given a pool's matches and a target lice +
 * start time, return one (liceId, scheduledAt) per match. Every match
 * moves to the target lice; the timed matches all shift by the same
 * delta = targetStart − earliest scheduled, so the pool's internal
 * spacing is preserved. Matches with no time stay unscheduled. When no
 * match has a time, only the lice changes.
 *
 * Kept separate from PhasesService so the math is testable without
 * mocking supabase. Mirrors pool-auto-distribute.ts.
 */
export interface PoolRescheduleUpdate {
  matchId: string;
  liceId: string | null;
  scheduledAt: string | null;
}

export function computePoolReschedule(
  matches: Array<{ id: string; scheduledAt: string | null }>,
  targetLiceId: string | null,
  targetStartIso: string,
): PoolRescheduleUpdate[] {
  const targetMs = new Date(targetStartIso).getTime();
  if (!Number.isFinite(targetMs)) {
    throw new Error(`Invalid targetStartIso: ${targetStartIso}`);
  }

  const timedMs = matches
    .map((m) => (m.scheduledAt ? new Date(m.scheduledAt).getTime() : null))
    .filter((ms): ms is number => ms !== null && Number.isFinite(ms));
  const earliest = timedMs.length ? Math.min(...timedMs) : null;
  const delta = earliest === null ? 0 : targetMs - earliest;

  return matches.map((m) => {
    if (!m.scheduledAt) {
      return { matchId: m.id, liceId: targetLiceId, scheduledAt: null };
    }
    const shifted = new Date(new Date(m.scheduledAt).getTime() + delta).toISOString();
    return { matchId: m.id, liceId: targetLiceId, scheduledAt: shifted };
  });
}
