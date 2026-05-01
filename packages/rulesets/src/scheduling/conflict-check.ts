/**
 * conflict-check.ts — Fighter/referee overlap detection
 *
 * Hard constraint (AGENTS.md rule #8):
 *   enforce_fighter_referee_no_overlap — a fighter cannot referee a pool
 *   whose time overlaps with their own match. This constraint CANNOT be disabled.
 *
 * Pure function — no DB, no I/O.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ScheduledMatch {
  id: string;
  label: string;
  /** Registration IDs of the two fighters */
  redRegistrationId: string;
  blueRegistrationId: string;
  scheduledAt: string | null; // ISO 8601
  durationMinutes: number; // default 5
}

export interface RefereeAssignment {
  matchId: string;
  matchLabel: string;
  /** Person ID of the referee */
  personId: string;
  personName: string;
  role: string; // arbitre_declarant | arbitre_assesseur | arbitre_table
  scheduledAt: string | null;
  durationMinutes: number;
}

/** Maps registrationId → personId (needed to cross-reference fighters) */
export interface RegistrationPersonMap {
  registrationId: string;
  personId: string;
  personName: string;
}

export interface FighterRefereeConflict {
  personId: string;
  personName: string;
  /** The match they are fighting in */
  fightingMatchId: string;
  fightingMatchLabel: string;
  fightingScheduledAt: string | null;
  /** The match they are refereeing */
  refereeingMatchId: string;
  refereeingMatchLabel: string;
  refereeingScheduledAt: string | null;
  refereeRole: string;
  /** true = confirmed overlap (both have scheduledAt), false = potential (one or both unscheduled) */
  confirmed: boolean;
}

export interface ConflictCheckResult {
  conflicts: FighterRefereeConflict[];
  /** true if any confirmed conflicts exist */
  hasConfirmedConflicts: boolean;
  /** true if any potential conflicts exist (unscheduled matches) */
  hasPotentialConflicts: boolean;
}

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Detect fighter/referee time conflicts.
 *
 * A conflict exists when the same person is:
 *   - registered as a fighter in match A
 *   - assigned as a referee in match B
 *   - AND the time windows of A and B overlap (or either is unscheduled)
 */
export function detectFighterRefereeConflicts(
  matches: ScheduledMatch[],
  refereeAssignments: RefereeAssignment[],
  registrationPersonMap: RegistrationPersonMap[],
): ConflictCheckResult {
  const conflicts: FighterRefereeConflict[] = [];

  // Build lookup: personId → matches they fight in
  const personFightingMatches = new Map<string, ScheduledMatch[]>();
  for (const reg of registrationPersonMap) {
    const fightingMatches = matches.filter(
      (m) =>
        m.redRegistrationId === reg.registrationId || m.blueRegistrationId === reg.registrationId,
    );
    if (fightingMatches.length > 0) {
      const existing = personFightingMatches.get(reg.personId) ?? [];
      personFightingMatches.set(reg.personId, [...existing, ...fightingMatches]);
    }
  }

  // For each referee assignment, check if the referee is also fighting
  for (const ref of refereeAssignments) {
    const fightingMatches = personFightingMatches.get(ref.personId);
    if (!fightingMatches || fightingMatches.length === 0) continue;

    for (const fightMatch of fightingMatches) {
      // Skip if same match (can't referee your own fight — separate validation)
      if (fightMatch.id === ref.matchId) continue;

      const overlaps = windowsOverlap(
        fightMatch.scheduledAt,
        fightMatch.durationMinutes,
        ref.scheduledAt,
        ref.durationMinutes,
      );

      if (overlaps !== 'no_overlap') {
        // Find person name from registration map
        const personName =
          ref.personName ||
          registrationPersonMap.find((r) => r.personId === ref.personId)?.personName ||
          ref.personId;

        conflicts.push({
          personId: ref.personId,
          personName,
          fightingMatchId: fightMatch.id,
          fightingMatchLabel: fightMatch.label,
          fightingScheduledAt: fightMatch.scheduledAt,
          refereeingMatchId: ref.matchId,
          refereeingMatchLabel: ref.matchLabel,
          refereeingScheduledAt: ref.scheduledAt,
          refereeRole: ref.role,
          confirmed: overlaps === 'confirmed_overlap',
        });
      }
    }
  }

  // Deduplicate: same person + same pair of matches (fighting + refereeing)
  const seen = new Set<string>();
  const deduped = conflicts.filter((c) => {
    const key = `${c.personId}:${c.fightingMatchId}:${c.refereeingMatchId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    conflicts: deduped,
    hasConfirmedConflicts: deduped.some((c) => c.confirmed),
    hasPotentialConflicts: deduped.some((c) => !c.confirmed),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type OverlapResult = 'confirmed_overlap' | 'potential_overlap' | 'no_overlap';

/**
 * Check if two time windows overlap.
 *
 * - If either scheduledAt is null → 'potential_overlap' (can't confirm, but flag it)
 * - If both have scheduledAt → check actual overlap → 'confirmed_overlap' or 'no_overlap'
 */
function windowsOverlap(
  startA: string | null,
  durationA: number,
  startB: string | null,
  durationB: number,
): OverlapResult {
  if (!startA || !startB) {
    // At least one is unscheduled — flag as potential
    return 'potential_overlap';
  }

  const aStart = new Date(startA).getTime();
  const aEnd = aStart + durationA * 60_000;
  const bStart = new Date(startB).getTime();
  const bEnd = bStart + durationB * 60_000;

  // Overlap if one starts before the other ends
  if (aStart < bEnd && bStart < aEnd) {
    return 'confirmed_overlap';
  }

  return 'no_overlap';
}
