/**
 * Referee scheduling-conflict + staffing-capacity detection.
 *
 * A referee is one body: they cannot officiate a pool/bracket while also
 * committed (fighting OR officiating) to a *different* pool/bracket whose
 * scheduled time window overlaps — even on a parallel lice, even in another
 * tournament. (Fighting in the *same* pool you officiate is handled by the
 * separate "can't referee your own pool" rule, not here.)
 *
 * Pure: no I/O, no React, no Node-only APIs — shared by the NestJS API
 * (candidate blocking + manual-assign rejection + board payload) and the
 * web-admin health panel.
 */

export interface RefereeCommitmentPool {
  id: string;
  name: string;
  tournamentId: string;
  tournamentName?: string | null;
  /** ISO start/end of the pool's scheduled window; null = unscheduled. */
  scheduledStart: string | null;
  scheduledEnd: string | null;
  liceName?: string | null;
  /** Number of referee role slots this pool/bracket needs. */
  roleSlotCount: number;
  /** Global person ids competing in this pool/bracket. */
  fighterPersonIds: string[];
  /** Currently-assigned referees. */
  assignments: Array<{ personId: string; personName: string; role: string }>;
}

export type RefereeConflictKind =
  | 'officiate_vs_fight'
  | 'double_booked'
  /** Assigned to a pool whose tournament/day is outside the referee's
   *  declared availability. Emitted by the API (not the pure time
   *  detector); `otherPool*` are unused for this kind. */
  | 'unavailable';

export interface RefereeConflict {
  personId: string;
  personName: string;
  kind: RefereeConflictKind;
  /** The officiating commitment that conflicts. */
  poolId: string;
  poolName: string;
  role: string;
  start: string | null;
  liceName?: string | null;
  /** The other commitment it overlaps. */
  otherPoolId: string;
  otherPoolName: string;
  otherLiceName?: string | null;
}

/** True when [aStart,aEnd) and [bStart,bEnd) overlap (both windows present). */
function windowsOverlap(a: RefereeCommitmentPool, b: RefereeCommitmentPool): boolean {
  if (!a.scheduledStart || !a.scheduledEnd || !b.scheduledStart || !b.scheduledEnd) return false;
  return (
    new Date(a.scheduledStart).getTime() < new Date(b.scheduledEnd).getTime() &&
    new Date(b.scheduledStart).getTime() < new Date(a.scheduledEnd).getTime()
  );
}

export interface RefereeForCapacity {
  personId: string;
  roles: string[];
  /** undefined = available for every tournament; otherwise an allowlist. */
  availableTournamentIds?: string[];
  /** undefined = available every day; otherwise an allowlist of day indices. */
  availableDayIndices?: number[];
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
 * referees who are free then — not fighting any active pool and available for
 * at least one active tournament/day. Flags windows that are impossible to
 * staff. Heuristic (not a full assignment feasibility solver).
 */
export function detectConcurrencyShortage(
  pools: RefereeCommitmentPool[],
  referees: RefereeForCapacity[],
  dayIndexOf: (iso: string) => number,
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
    const activeTournaments = new Set(active.map((p) => p.tournamentId));
    const dayIndex = dayIndexOf(start);

    const free = referees.filter((ref) => {
      if (fighting.has(ref.personId)) return false;
      const tournamentOk =
        !ref.availableTournamentIds ||
        ref.availableTournamentIds.some((id) => activeTournaments.has(id));
      const dayOk = !ref.availableDayIndices || ref.availableDayIndices.includes(dayIndex);
      return tournamentOk && dayOk;
    }).length;

    if (needed > free) {
      warnings.push({ start, end, liceCount: active.length, needed, free });
    }
  }
  return warnings;
}

/**
 * Would assigning `personId` to officiate `targetPoolId` collide with one of
 * their existing time commitments in a *different* pool/bracket? Returns the
 * first collision (fighting or already-officiating) or null. Fighting in the
 * target pool itself is intentionally NOT a collision here — the separate
 * "can't referee your own pool" block owns that case.
 */
export function findTimeConflict(
  personId: string,
  targetPoolId: string,
  pools: RefereeCommitmentPool[],
): { kind: RefereeConflictKind; otherPoolName: string } | null {
  const target = pools.find((p) => p.id === targetPoolId);
  if (!target || !target.scheduledStart || !target.scheduledEnd) return null;
  for (const other of pools) {
    if (other.id === targetPoolId) continue;
    if (!windowsOverlap(target, other)) continue;
    if (other.fighterPersonIds.includes(personId)) {
      return { kind: 'officiate_vs_fight', otherPoolName: other.name };
    }
    if (other.assignments.some((a) => a.personId === personId)) {
      return { kind: 'double_booked', otherPoolName: other.name };
    }
  }
  return null;
}

function base(
  assignment: { personId: string; personName: string; role: string },
  officiating: RefereeCommitmentPool,
  other: RefereeCommitmentPool,
): Omit<RefereeConflict, 'kind'> {
  return {
    personId: assignment.personId,
    personName: assignment.personName,
    poolId: officiating.id,
    poolName: officiating.name,
    role: assignment.role,
    start: officiating.scheduledStart,
    liceName: officiating.liceName ?? null,
    otherPoolId: other.id,
    otherPoolName: other.name,
    otherLiceName: other.liceName ?? null,
  };
}

export function detectRefereeConflicts(pools: RefereeCommitmentPool[]): RefereeConflict[] {
  const scheduled = pools.filter((p) => p.scheduledStart && p.scheduledEnd);
  const conflicts: RefereeConflict[] = [];

  for (const officiating of scheduled) {
    for (const assignment of officiating.assignments) {
      for (const other of scheduled) {
        if (other.id === officiating.id) continue;
        if (!windowsOverlap(officiating, other)) continue;
        // R-1: officiating one pool while fighting in a different one.
        if (other.fighterPersonIds.includes(assignment.personId)) {
          conflicts.push({
            ...base(assignment, officiating, other),
            kind: 'officiate_vs_fight',
          });
        }
        // R-2: officiating two overlapping pools (double-booked).
        // Report each unordered pool pair once (id < otherId).
        if (
          officiating.id < other.id &&
          other.assignments.some((a) => a.personId === assignment.personId)
        ) {
          conflicts.push({
            ...base(assignment, officiating, other),
            kind: 'double_booked',
          });
        }
      }
    }
  }

  return conflicts;
}
