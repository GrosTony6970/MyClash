/**
 * Which card a penalty entry will ACTUALLY produce for this fighter.
 *
 * The pad's picker used to show `entry.sanctions[0]` — always the
 * first-occurrence card. Escalation is the whole point of that array: an entry
 * lists the card for a first offence, a second, a third. So on a fighter's
 * second offence in the same rule group the button said yellow and the server
 * issued red. Wrong online as much as offline, and invisible either way,
 * because the button looked like a considered answer.
 *
 * `computePenaltySanction` is the server's own function, moved to
 * `@myclash/types` so both sides can call it, and `priors` is the array the
 * server gathers for itself — see `GET /matches/:id/penalty-scope`. The pad is
 * not reasoning about escalation; it is asking the same question of the same
 * code with the same input.
 *
 * Pure: no React, no I/O.
 */
import { computePenaltySanction, type ExistingPenaltyForSanction } from '@myclash/types';
import type { PenaltyCard } from '@myclash/ui';

/** The catalogue entry as the pad receives it — snake_case, straight off the wire. */
export interface WireEntry {
  group_number: number;
  ref_number: number | string;
  short_name: string;
  description: string;
  sanctions: PenaltyCard[];
}

export function resolveEntryCard(
  entry: WireEntry,
  registrationId: string,
  priors: ExistingPenaltyForSanction[] | undefined,
): PenaltyCard | undefined {
  // No priors read yet. The first-occurrence card is the right answer for a
  // fighter with no prior offences, which is most of them, and it is what the
  // picker showed before — so an unresolved scope degrades to the old
  // behaviour rather than to a blank or a wrong claim.
  if (!priors) return entry.sanctions[0];

  return computePenaltySanction(
    {
      groupNumber: entry.group_number,
      refNumber: String(entry.ref_number),
      shortName: entry.short_name,
      description: entry.description,
      sanctions: entry.sanctions,
    },
    priors,
    registrationId,
  ).card;
}
