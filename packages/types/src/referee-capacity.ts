/**
 * Referee staffing capacity — "not enough referees at this time".
 *
 * This is a warning about the whole slate, never a verdict on one person
 * (ADR-016): it has its own switch and it never blocks. Whether one person may
 * referee one unit is the checker's question, in
 * `@myclash/rulesets/scheduling/referee-checker`.
 *
 * Pure: no I/O, no React, no Node-only APIs.
 */
import { isAvailableFor, type RefereeAvailability } from './referee-availability';

export interface RefereeCommitmentPool {
  id: string;
  tournamentId: string;
  /** ISO start/end of the unit's planned window; null = unscheduled. */
  scheduledStart: string | null;
  scheduledEnd: string | null;
  /** Number of referee role slots this unit needs. */
  roleSlotCount: number;
  /** Global person ids competing in this unit. */
  fighterPersonIds: string[];
}

export interface RefereeForCapacity {
  personId: string;
  roles: string[];
  availability: RefereeAvailability;
}

export interface CapacityWarning {
  start: string;
  end: string;
  /** Number of pools/brackets running in parallel during the window. */
  liceCount: number;
  /** Referee slots needed across those parallel pools. */
  needed: number;
  /** Referees free to officiate during the window. */
  free: number;
}

/**
 * Sweep-line over scheduled pool windows: for each interval where the set of
 * active pools is constant, compare slots needed (Σ roleSlotCount) against the
 * referees who are free then — not fighting any active pool and available
 * (`isAvailableFor`, the checker's own test) for at least one active pool over
 * that interval. The interval is a stretch between two pool edges, not a pool's
 * whole run, so it can count someone the checker would refuse for the pool: it
 * under-warns, never over-warns. Flags windows that are impossible to staff.
 * Heuristic (not a full assignment feasibility solver).
 *
 * `dateOf` is the calendar date of an instant on the Event's clock.
 */
export function detectConcurrencyShortage(
  pools: RefereeCommitmentPool[],
  referees: RefereeForCapacity[],
  dateOf: (iso: string) => string | null,
): CapacityWarning[] {
  const scheduled = pools.filter(
    (p): p is RefereeCommitmentPool & { scheduledStart: string; scheduledEnd: string } =>
      Boolean(p.scheduledStart && p.scheduledEnd),
  );
  if (scheduled.length === 0) return [];

  const boundaries = Array.from(
    new Set(scheduled.flatMap((p) => [p.scheduledStart, p.scheduledEnd])),
  ).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  const warnings: CapacityWarning[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i]!;
    const end = boundaries[i + 1]!;
    const mid = new Date(start).getTime();
    const active = scheduled.filter(
      (p) =>
        new Date(p.scheduledStart).getTime() <= mid && new Date(p.scheduledEnd).getTime() > mid,
    );
    if (active.length === 0) continue;

    const needed = active.reduce((sum, p) => sum + p.roleSlotCount, 0);
    const fighting = new Set(active.flatMap((p) => p.fighterPersonIds));
    const date = dateOf(start);
    const window = { startMs: mid, endMs: new Date(end).getTime() };

    const free = referees.filter(
      (ref) =>
        !fighting.has(ref.personId) &&
        active.some((p) =>
          isAvailableFor(ref.availability, { tournamentId: p.tournamentId, date, window }),
        ),
    ).length;

    if (needed > free) {
      warnings.push({ start, end, liceCount: active.length, needed, free });
    }
  }
  return warnings;
}
