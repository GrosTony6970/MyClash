/**
 * instructor-busy.ts — when the Event's Workshop instructors fight or referee (rulings 553-555),
 * for the Workshop board's red card. The board does the overlap; this picks the times.
 *
 * It reads the commitments the referee checker reads (`event-commitments.ts`, ADR-016), so the
 * two boards cannot disagree about who is busy when:
 *   - a fighter is busy for their whole Pool or Swiss round (`fight-pool`, the 2026-09-17
 *     ruling); a bout of that group lies inside it, so it would only repeat it;
 *   - a bracket bout belongs to no group: its own window (`fight` with no group);
 *   - a referee duty: its Pool's span or its bout's window.
 * Teaching and attending are left out: the board has the Workshops itself, and an attendance
 * is a private booking (ADR-016, migration 0205).
 *
 * Pure: no I/O.
 */
import type { RefereeCommitment } from '@myclash/rulesets/scheduling/referee-checker';
import type { WorkshopInstructorBusy } from '@myclash/types';

function busyKind(commitment: RefereeCommitment): WorkshopInstructorBusy['kind'] | null {
  if (commitment.kind === 'fight-pool') return 'fight';
  if (commitment.kind === 'fight') return commitment.groupId === null ? 'fight' : null;
  if (commitment.kind === 'referee') return 'referee';
  return null;
}

export function instructorBusy(
  commitments: readonly RefereeCommitment[],
  instructorIds: ReadonlySet<string>,
): WorkshopInstructorBusy[] {
  const busy: WorkshopInstructorBusy[] = [];
  for (const commitment of commitments) {
    const kind = busyKind(commitment);
    if (kind === null || commitment.window === null) continue;
    if (!instructorIds.has(commitment.personId)) continue;
    busy.push({
      personId: commitment.personId,
      kind,
      label: commitment.label,
      startsAt: new Date(commitment.window.startMs).toISOString(),
      endsAt: new Date(commitment.window.endMs).toISOString(),
    });
  }
  return busy.sort(
    (a, b) => a.personId.localeCompare(b.personId) || a.startsAt.localeCompare(b.startsAt),
  );
}
