/**
 * Pure conflict detection for the schedule grid. Extracted from grid.tsx
 * so the logic is testable without mounting React. The grid imports
 * `detectConflicts` and renders the resulting `Conflict[]` in its
 * banner.
 *
 * Times are resolved in the EVENT's timezone, matching the axis geometry in
 * `@myclash/schedule-core`. The banner used to build its `time` with
 * `Date#getHours`, which is the viewer's zone: detection was still correct
 * (the overlap test is epoch arithmetic) but a Paris double-booking at 09:00
 * read as "at 03:00" to an organiser on a US laptop.
 */
import { minutesIntoDayInZone } from '@myclash/time';

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
/** `HH:MM` on the event's wall clock, locale-free (identical in every locale). */
function hhmmInZone(iso: string, tz: string): string {
  const minutes = minutesIntoDayInZone(iso, tz);
  if (minutes === null) return '';
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function detectConflicts(
  matches: ScheduleMatchForConflict[],
  tz: string,
  unknownFighterLabel: string,
): Conflict[] {
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
          personName: nameByRegistration.get(shared[0]!) ?? unknownFighterLabel,
          time: hhmmInZone(a.scheduledAt!, tz),
        });
      }
    }
  }
  return conflicts;
}
