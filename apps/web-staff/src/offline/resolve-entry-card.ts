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

/** A card the tablet still holds, as its row of the timeline says it. */
interface QueuedCardRow {
  registration_id: string;
  group_number?: number | null;
  card: PenaltyCard;
  source: 'ruleset' | 'direct';
}

/**
 * The offences the server will count when this fighter's next card arrives:
 * the ones it told the pad, plus the cards this tablet still holds for them.
 *
 * Without the held ones, a second offence given with no network read as a
 * first: the button said yellow, the pad gave it in one tap, and the server
 * issued red when the queue went out.
 *
 * Offences that were never read stay "not read" while nothing is held, so
 * `resolveEntryCard` keeps its first-occurrence answer for that case.
 */
export function priorsWithQueued(
  priors: ExistingPenaltyForSanction[] | undefined,
  queued: readonly QueuedCardRow[],
  registrationId: string,
): ExistingPenaltyForSanction[] | undefined {
  const held = queued
    .filter((row) => row.registration_id === registrationId)
    .map((row) => ({
      registrationId,
      card: row.card,
      source: row.source,
      ...(row.group_number == null ? {} : { groupNumber: row.group_number }),
    }));
  if (!priors && held.length === 0) return undefined;
  return [...(priors ?? []), ...held];
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
