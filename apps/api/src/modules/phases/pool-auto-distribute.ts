/**
 * Pure round-robin fan-out: given N matches, M parallel lices, a start
 * time, and a slot duration, return one (liceId, scheduledAt) pair per
 * match. Match i goes to lice (i % M) at time `start + floor(i / M) *
 * duration`.
 *
 * Kept separate from PhasesService so the math is easy to test without
 * mocking supabase.
 */
export interface PoolAutoDistributeAssignment {
  matchId: string;
  liceId: string;
  scheduledAt: string;
}

export function distributePoolMatches(opts: {
  matchIds: string[];
  liceIds: string[];
  startAtIso: string;
  durationMinutes: number;
}): PoolAutoDistributeAssignment[] {
  if (opts.liceIds.length === 0) {
    throw new Error('At least one lice is required to auto-distribute.');
  }
  if (opts.durationMinutes <= 0) {
    throw new Error('durationMinutes must be > 0.');
  }
  const startMs = new Date(opts.startAtIso).getTime();
  if (!Number.isFinite(startMs)) {
    throw new Error(`Invalid startAtIso: ${opts.startAtIso}`);
  }

  const parallel = opts.liceIds.length;
  return opts.matchIds.map((matchId, i) => {
    const liceIdx = i % parallel;
    const rowIdx = Math.floor(i / parallel);
    const at = new Date(startMs + rowIdx * opts.durationMinutes * 60_000);
    return {
      matchId,
      liceId: opts.liceIds[liceIdx]!,
      scheduledAt: at.toISOString(),
    };
  });
}

/**
 * Rotate the ordered lice list so it starts at `startLiceId`. The
 * operator drops a pool onto a starting cell — we want the first match
 * to land on that lice, the second on the next, wrapping when needed.
 *
 * If `startLiceId` is null or not in the list, the lice order is
 * returned untouched (operator's "any lice" fallback).
 */
export function rotateLicesFrom(orderedLiceIds: string[], startLiceId: string | null): string[] {
  if (!startLiceId) return [...orderedLiceIds];
  const idx = orderedLiceIds.indexOf(startLiceId);
  if (idx <= 0) return [...orderedLiceIds];
  return [...orderedLiceIds.slice(idx), ...orderedLiceIds.slice(0, idx)];
}
