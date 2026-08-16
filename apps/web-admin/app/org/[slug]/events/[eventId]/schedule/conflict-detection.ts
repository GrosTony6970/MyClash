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
  id: string;
  matchNumberLabel: string;
  /** Canonical code (`LSW-P1-M1`). What every card on the board prints. */
  roundCode?: string;
  status: string;
  liceId: string | null;
  scheduledAt: string | null;
  durationMinutes: number;
  redRegistrationId: string;
  blueRegistrationId: string;
  redFighterName: string | null;
  blueFighterName: string | null;
}

export interface Conflict {
  /** The card label, not the raw number — see `conflictLabel`. */
  matchA: string;
  matchB: string;
  /**
   * Match ids for the two bouts. The banner names bouts by label, but labels
   * are not unique across tournaments, so the grid's amber tint needs ids to
   * point at the right cards. See `conflictLabel`.
   */
  matchAId: string;
  matchBId: string;
  personName: string;
  time: string;
}

/**
 * How a bout is named to the operator: the code its card shows.
 *
 * Every card on the board prints `roundCode || matchNumberLabel` —
 * `DetailedMatchCards` and `MatchChip` both do. The banner printed
 * `matchNumberLabel` alone, which for a bracket bout is a bare sequence number
 * ("2"), so the banner and the card called the same fight different things.
 * Worse, that number is not unique across tournaments: two tournaments can each
 * hold a match "2", and a cross-tournament line read "2 and 2".
 */
function conflictLabel(m: ScheduleMatchForConflict): string {
  return m.roundCode || m.matchNumberLabel;
}

/**
 * Find every pair of scheduled matches that share a fighter AND overlap
 * in time. The conflict's `personName` is always a human-readable
 * label — never a registration UUID. When the offending match doesn't
 * carry the fighter's name (bracket matches sometimes don't), we cross-
 * reference every other match in the schedule first. Only when no match
 * anywhere has the name do we fall through to "Unknown fighter".
 */
/**
 * `HH:MM` on the event's wall clock, locale-free (identical in every locale).
 *
 * Exported because the referee banner needs the same clock. Two copies would be
 * two chances to reach for `Date#getHours` again, which is the bug the docblock
 * at the top of this file records: detection stayed right and the printed time
 * went wrong, so nothing failed — it just read 03:00 to an organiser abroad.
 * Returns '' when the timestamp cannot be read, which callers treat as "no time
 * to show".
 */
export function hhmmInZone(iso: string, tz: string): string {
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
  // A voided bout is not happening, so it cannot double-book anybody. Voiding
  // writes `status` and nothing else — it leaves `lice_id` and `scheduled_at`
  // in place — and the grid payload has no status filter, so a cancelled fight
  // arrived here as an occupant and could raise a conflict against a real one.
  // The server has always excluded voided from its own occupancy query; this is
  // the same rule on the same data.
  const scheduled = matches.filter((m) => m.scheduledAt && m.liceId && m.status !== 'voided');
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
          matchA: conflictLabel(a),
          matchB: conflictLabel(b),
          matchAId: a.id,
          matchBId: b.id,
          personName: nameByRegistration.get(shared[0]!) ?? unknownFighterLabel,
          time: hhmmInZone(a.scheduledAt!, tz),
        });
      }
    }
  }
  return conflicts;
}
