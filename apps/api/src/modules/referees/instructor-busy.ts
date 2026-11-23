/**
 * instructor-busy.ts — when the Event's Workshop instructors fight or referee (rulings 553-555),
 * for the Workshop board's red card. The board does the overlap; this picks the times.
 *
 * It reads the commitments the referee checker reads (`event-commitments.ts`, ADR-016), so the
 * two boards cannot disagree about who is busy when:
 *   - a fighter is busy for their whole block (`fight-pool`): a Pool (the 2026-09-17 ruling), a
 *     Swiss phase, and a bracket from its first bout until they are out (operator, 2026-11-23);
 *     a bout of the block lies inside it, so it would only repeat it;
 *   - a referee duty: its Pool's span or its bout's window.
 * Teaching and attending are left out: the board has the Workshops itself, and an attendance
 * is a private booking (ADR-016, migration 0205).
 *
 * Pure: no I/O.
 */
import type { RefereeCommitment } from '@myclash/rulesets/scheduling/referee-checker';
import type { WorkshopInstructorBusy } from '@myclash/types';

/** A Swiss phase or a bracket, from its block id (`spanIdOf`); null for a Pool. */
function blockOf(groupId: string): WorkshopInstructorBusy['block'] {
  if (groupId.startsWith('elim:')) return 'elimination';
  if (groupId.startsWith('swiss:')) return 'swiss';
  return null;
}

function busyOf(
  commitment: RefereeCommitment,
): Pick<WorkshopInstructorBusy, 'kind' | 'block'> | null {
  if (commitment.kind === 'fight-pool')
    return { kind: 'fight', block: blockOf(commitment.groupId) };
  if (commitment.kind === 'referee') return { kind: 'referee', block: null };
  return null;
}

export function instructorBusy(
  commitments: readonly RefereeCommitment[],
  instructorIds: ReadonlySet<string>,
): WorkshopInstructorBusy[] {
  const busy: WorkshopInstructorBusy[] = [];
  for (const commitment of commitments) {
    const what = busyOf(commitment);
    if (what === null || commitment.window === null) continue;
    if (!instructorIds.has(commitment.personId)) continue;
    busy.push({
      personId: commitment.personId,
      ...what,
      label: commitment.label,
      startsAt: new Date(commitment.window.startMs).toISOString(),
      endsAt: new Date(commitment.window.endMs).toISOString(),
    });
  }
  return busy.sort(
    (a, b) => a.personId.localeCompare(b.personId) || a.startsAt.localeCompare(b.startsAt),
  );
}
