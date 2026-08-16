/**
 * What a card the referee just issued will be worth, worked out on the tablet.
 *
 * WHY THE PAD IS ALLOWED TO DO THIS. `ARCHITECTURE.md` §7.3: the pad may run
 * pure catalogue arithmetic over data it already fetches, and must never need
 * the AST-driven `FormulaRuleset`. A penalty ruleset is a catalogue — entries,
 * the card each occurrence carries, and three integer columns of per-card
 * points — that `GET /matches/:id/penalty-ruleset` already sends in full and
 * `fetchWithCache` already keeps on the tablet. Both functions below are the
 * SERVER'S own, called on the server's own input, so the two cannot reach
 * different answers by reasoning differently.
 *
 * IT IS A FOLD, NOT A MAP. `computePenaltySanction` escalates on how many
 * offences the fighter already has in the same rule group, so two queued cards
 * in one group are not independent: the second is priced against a world that
 * includes the first. The server sees exactly that when the outbox drains in
 * order, which is why this is driven row by row and carries state.
 *
 * WHEN IT REFUSES. Returning `null` is a real answer and the caller must show
 * it as one. Guessing here is worse than admitting ignorance, because the guess
 * is silent and lands in a number a referee reads.
 *
 * Pure: no React, no I/O, no Dexie.
 */
import {
  penaltyScoreDelta,
  type ExistingPenaltyForSanction,
  type PenaltyCard,
} from '@myclash/types';
import { resolveEntryCard, type WireEntry } from './resolve-entry-card';

/** A catalogue row as the pad receives it. `id` is what an outbox row names. */
export interface CatalogueEntry extends WireEntry {
  id: string;
}

/**
 * The bits of the penalty ruleset pricing needs.
 *
 * Structural rather than an import of `PenaltyRuleset` from the hook: this
 * module is pure and must not acquire a dependency on a React hook module to
 * borrow a type.
 */
export interface PricingRuleset {
  yellow_card_points?: number | null;
  red_card_points?: number | null;
  black_card_points?: number | null;
  penalty_ruleset_entries?: readonly CatalogueEntry[];
}

export interface QueuedCardPricing {
  /** The match's effective penalty ruleset; null when the pad has never had it. */
  ruleset: PricingRuleset | null;
  /**
   * Prior offences per registration, from `GET /matches/:id/penalty-scope`.
   *
   * NULL IS NOT AN EMPTY LIST. That endpoint is the only one of the pad's three
   * penalty reads that is not `@Public()` — it runs `authorizeMatchScoring` —
   * so a lapsed session leaves the catalogue loaded and this null indefinitely.
   * `resolveEntryCard` degrades to the first-occurrence card when it gets no
   * priors, which is the right trade for LABELLING A BUTTON and the wrong one
   * for a score: on a fighter's second offence the pad would claim yellow (0)
   * while the server issues red (−1). So null means unpriceable, full stop.
   */
  priors: Record<string, ExistingPenaltyForSanction[]> | null;
}

/** One queued card, in the only terms pricing needs. */
export interface QueuedCard {
  registrationId: string;
  rulesetEntryId?: string | undefined;
  directCard?: PenaltyCard | undefined;
}

export interface PricedCard {
  card: PenaltyCard;
  /** Points this card moves the CARDED fighter's own score by. Often 0. */
  scoreDelta: number;
  /** Null for a direct card — it belongs to no rule group. */
  groupNumber: number | null;
  source: 'ruleset' | 'direct';
}

export interface CardPricer {
  /** The priced card, or null when the pad cannot honestly say. */
  price: (card: QueuedCard) => PricedCard | null;
}

/**
 * The per-card cost, mirroring `cardScoreDelta` in the penalties service.
 *
 * A missing or non-numeric column reads as 0 because that is what the server
 * stores, not because 0 is a sensible default. Unreachable against a real
 * database — migration 0054 declares all three `INT NOT NULL DEFAULT` — and
 * kept faithful anyway so the two implementations do not diverge on an edge
 * neither is exercising.
 */
function cardPoints(ruleset: PricingRuleset, card: PenaltyCard): number {
  const value =
    card === 'yellow'
      ? ruleset.yellow_card_points
      : card === 'red'
        ? ruleset.red_card_points
        : ruleset.black_card_points;
  return typeof value === 'number' ? value : 0;
}

/**
 * The ruleset branch: resolve which card this offence earns, then price it.
 *
 * Mutates `working` — that IS the fold. The next card in this group is the
 * fighter's next offence, and only a non-voided, ruleset-sourced card counts,
 * because those are the two filters `computePenaltySanction` applies.
 */
function priceRulesetCard(
  ruleset: PricingRuleset,
  entry: CatalogueEntry,
  registrationId: string,
  working: Map<string, ExistingPenaltyForSanction[]>,
): PricedCard | null {
  const seen = working.get(registrationId) ?? [];
  const card = resolveEntryCard(entry, registrationId, seen);
  if (!card) return null;

  working.set(registrationId, [
    ...seen,
    { registrationId, groupNumber: entry.group_number, card, source: 'ruleset', voided: false },
  ]);

  return {
    card,
    source: 'ruleset',
    groupNumber: entry.group_number,
    scoreDelta: cardPoints(ruleset, card),
  };
}

/**
 * A pricer for one pass over one match's queued cards.
 *
 * Stateful on purpose, and single-use: it carries the priors forward as it
 * goes. Drive it in outbox `id` order — `getPendingForMatch` sorts by it and
 * the drain posts in it, so that order is what the server will see. Call it
 * only on rows that survived the outbox/server dedupe: a card sitting in the
 * window between a successful POST and `markSynced` is in the outbox AND in the
 * priors this was built from, and folding it in again invents an occurrence.
 */
export function createCardPricer(pricing: QueuedCardPricing): CardPricer {
  const { ruleset, priors } = pricing;

  const byId = new Map<string, CatalogueEntry>();
  for (const entry of ruleset?.penalty_ruleset_entries ?? []) byId.set(entry.id, entry);

  // Copied, never mutated in place: `priors` belongs to the caller's React
  // state and a fold that wrote through it would grow the array on every
  // render.
  const working = new Map<string, ExistingPenaltyForSanction[]>();
  for (const [registrationId, rows] of Object.entries(priors ?? {})) {
    working.set(registrationId, [...rows]);
  }

  return {
    price(queued) {
      // A DIRECT card needs no catalogue and no priors — the referee named the
      // colour, and `computeDirectPenaltySanction` ignores prior offences
      // because a direct card is the referee overriding the ladder. With no
      // ruleset at all the server falls back to `penaltyScoreDelta`, so this
      // does too rather than reporting a card it can plainly price.
      if (queued.directCard) {
        return {
          card: queued.directCard,
          source: 'direct',
          groupNumber: null,
          scoreDelta: ruleset
            ? cardPoints(ruleset, queued.directCard)
            : penaltyScoreDelta(queued.directCard),
        };
      }

      if (!ruleset || !priors) return null;

      const entry = queued.rulesetEntryId ? byId.get(queued.rulesetEntryId) : undefined;
      // An entry the catalogue does not have. A stale queue against a ruleset
      // the organiser re-pinned mid-event lands here, and the server will
      // decide it — not this.
      if (!entry) return null;

      return priceRulesetCard(ruleset, entry, queued.registrationId, working);
    },
  };
}
