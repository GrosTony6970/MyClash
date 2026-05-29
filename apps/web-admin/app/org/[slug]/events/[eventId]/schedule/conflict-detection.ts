/**
 * Pure conflict detection for the schedule grid. Extracted from grid.tsx
 * so the logic is testable without mounting React. The grid imports
 * `detectConflicts` and renders the resulting `Conflict[]` in its
 * banner.
 */

export interface ScheduleMatchForConflict {
  matchNumberLabel: string;
  liceId: string | null;
  scheduledAt: string | null;
  durationMinutes: number;
  redRegistrationId: string;
  blueRegistrationId: string;
  redFighterName: string | null;
  blueFighterName: string | null;
}

export interface Conflict {
  matchA: string;
  matchB: string;
  personName: string;
  time: string;
}

/**
 * Find every pair of scheduled matches that share a fighter AND overlap
 * in time. The conflict's `personName` is always a human-readable
 * label — never a registration UUID. When the offending match doesn't
 * carry the fighter's name (bracket matches sometimes don't), we cross-
 * reference every other match in the schedule first. Only when no match
 * anywhere has the name do we fall through to "Unknown fighter".
 */
export function detectConflicts(matches: ScheduleMatchForConflict[]): Conflict[] {
  const nameByRegistration = new Map<string, string>();
  for (const m of matches) {
    if (m.redRegistrationId && m.redFighterName) {
      nameByRegistration.set(m.redRegistrationId, m.redFighterName);
    }
    if (m.blueRegistrationId && m.blueFighterName) {
      nameByRegistration.set(m.blueRegistrationId, m.blueFighterName);
    }
  }

  const conflicts: Conflict[] = [];
  const scheduled = matches.filter((m) => m.scheduledAt && m.liceId);
  for (let i = 0; i < scheduled.length; i++) {
    for (let j = i + 1; j < scheduled.length; j++) {
      const a = scheduled[i]!;
      const b = scheduled[j]!;
      const aFighters = [a.redRegistrationId, a.blueRegistrationId].filter(Boolean);
      const bFighters = [b.redRegistrationId, b.blueRegistrationId].filter(Boolean);
      const shared = aFighters.filter((f) => bFighters.includes(f));
      if (shared.length === 0) continue;
      const aStart = new Date(a.scheduledAt!).getTime();
      const aEnd = aStart + a.durationMinutes * 60_000;
      const bStart = new Date(b.scheduledAt!).getTime();
      const bEnd = bStart + b.durationMinutes * 60_000;
      if (aStart < bEnd && bStart < aEnd) {
        conflicts.push({
          matchA: a.matchNumberLabel,
          matchB: b.matchNumberLabel,
          personName: nameByRegistration.get(shared[0]!) ?? 'Unknown fighter',
          time: new Date(a.scheduledAt!).toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit',
          }),
        });
      }
    }
  }
  return conflicts;
}
