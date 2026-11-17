/**
 * The card a protest past the limit offers: the penalty the organiser chose,
 * found in the Match's penalty list by its ref. Asked after the protest is
 * recorded, at every protest past the limit (with a limit of 2, the third and
 * each one after it).
 *
 * Nothing is offered with no limit, with no penalty chosen, when the chosen
 * penalty is not in the list, or when the pad takes no card now (between
 * rounds, after the end): the server would refuse that card, and an offer that
 * ends in the held inbox is worse than none. The chip still counts and warns.
 *
 * Pure, out of the component: web-staff has no React test setup.
 */
import type { PenaltyRulesetEntry } from '../hooks/usePenalties';

export function protestOffer(args: {
  /** The Fighter's protests, the one just tapped included. */
  countAfterTap: number;
  limit: number | null;
  offerPenaltyRef: string | null;
  entries: readonly PenaltyRulesetEntry[];
  /** The pad takes a card now (`scoringEnabled`). */
  cardEntryLive: boolean;
}): PenaltyRulesetEntry | null {
  const { countAfterTap, limit, offerPenaltyRef, entries, cardEntryLive } = args;
  if (!cardEntryLive || limit === null || offerPenaltyRef === null) return null;
  if (countAfterTap <= limit) return null;
  // The API sends a ref as text (TEXT since migration 0071), whatever the entry's type says.
  return entries.find((entry) => String(entry.ref_number) === offerPenaltyRef) ?? null;
}

/**
 * One Fighter's protests as the column knows them: the ones the screen last
 * drew (`shown`, by `client_uuid`), and the ones this column wrote that the
 * screen does not show yet (`unseen`). Kept across draws (a ref).
 *
 * The race it handles: a tap is written, then the screen draws the new count
 * only after the queue is read again, which is asynchronous. A second tap that
 * lands in between would read the old count from its draw: with the chip at 1,
 * two quick taps reach 3, but the second would count 2 and not offer. So the
 * count after a tap is the drawn protests plus the written ones not drawn yet.
 * A protest leaves `unseen` once a draw shows it, so an undo after that draw
 * takes it out of the count too.
 */
export interface ProtestsSeen {
  shown: ReadonlySet<string>;
  unseen: Set<string>;
}

export const protestsSeen = (): ProtestsSeen => ({ shown: new Set(), unseen: new Set() });

/** The screen drew these protests of the Fighter: each one is counted by the draw now. */
export function protestsShown(seen: ProtestsSeen, shown: ReadonlySet<string>): void {
  seen.shown = shown;
  for (const clientUuid of shown) seen.unseen.delete(clientUuid);
}

/** A protest was written: the Fighter's count now, with the written ones not drawn yet. */
export function protestWritten(seen: ProtestsSeen, clientUuid: string): number {
  if (!seen.shown.has(clientUuid)) seen.unseen.add(clientUuid);
  return seen.shown.size + seen.unseen.size;
}

/**
 * A tap of the protest button, then the offer: the protest is recorded first
 * (`tap`, which answers what it wrote, or null for a tap it ignored), then the
 * penalty past the limit is looked up on the count after this tap.
 */
export async function protestThenOffer(args: {
  tap: () => Promise<string | null>;
  seen: ProtestsSeen;
  limit: number | null;
  offerPenaltyRef: string | null;
  entries: readonly PenaltyRulesetEntry[];
  cardEntryLive: boolean;
}): Promise<PenaltyRulesetEntry | null> {
  const { tap, seen, ...rules } = args;
  const written = await tap();
  if (written === null) return null;
  return protestOffer({ ...rules, countAfterTap: protestWritten(seen, written) });
}
