/**
 * Penalty cards and how a repeated offence escalates.
 *
 * WHY THIS IS IN @myclash/types RATHER THAN @myclash/rulesets. It used to live
 * beside the CSV importer in the rulesets package, which put it out of reach of
 * the referee pad — `@myclash/rulesets` is deliberately not a dependency of
 * `apps/web-staff` or `packages/ui`, and must not become one (see "Seed, don't
 * resolve" in ARCHITECTURE.md §7.3).
 *
 * That rule is about the SCORING engine: the AST-driven `FormulaRuleset` a
 * tournament's ruleset can resolve to, which needs a database and cannot be
 * reached from a tablet in a dead hall. A PENALTY ruleset is not that. It is a
 * catalogue of rows — entries, the cards each one carries, and per-card point
 * values — that the pad ALREADY fetches in full from
 * `GET /matches/:id/penalty-ruleset`. Everything below is pure array work over
 * that data: no zod, no engine, no I/O.
 *
 * Keeping it here means the pad and the server compute a card from one
 * function, so they cannot drift. `@myclash/rulesets` re-exports the lot, so
 * the API's existing imports are unaffected.
 */

export type PenaltyCard = 'yellow' | 'red' | 'black';
export type PenaltyAccumulationScope = 'match' | 'phase' | 'tournament';
export type PenaltySource = 'ruleset' | 'direct';

export interface PenaltyRulesetEntry {
  groupNumber: number;
  /**
   * Identifier of the rule within its group. String to allow alphanumeric
   * rulebook references like "R7a" or "B-12". The engine treats it as
   * opaque — validation only enforces non-empty + a safe-char set at the
   * input boundary (CSV parser and API DTO).
   */
  refNumber: string;
  shortName: string;
  description: string;
  sanctions: readonly PenaltyCard[];
}

/**
 * A penalty already recorded against a fighter, as the accumulation counter
 * needs to see it.
 *
 * `groupNumber` and `source` are both load-bearing filters, not decoration: a
 * card from another rule group does not escalate this one, and a DIRECT card —
 * issued by the referee outside the catalogue — never counts toward a group's
 * occurrence at all.
 */
export interface ExistingPenaltyForSanction {
  registrationId: string;
  groupNumber?: number;
  card: PenaltyCard;
  source: PenaltySource;
  voided?: boolean;
}

export interface PenaltySanctionResult {
  card: PenaltyCard;
  groupOccurrence: number;
  scoreDelta: number;
  causesMatchForfeit: boolean;
}

export function normalizePenaltyCard(value: string): PenaltyCard {
  const normalized = value.trim().toLowerCase();
  if (['jaune', 'yellow'].includes(normalized)) return 'yellow';
  if (['rouge', 'red'].includes(normalized)) return 'red';
  if (['noir', 'black'].includes(normalized)) return 'black';
  throw new Error(`Unknown penalty card "${value}"`);
}

/**
 * The default cost of a card, when no penalty ruleset row overrides it.
 *
 * A ruleset row's `yellow_/red_/black_card_points` columns take precedence —
 * see `cardScoreDelta` in the penalties service. Migration 0054 seeds those
 * columns to exactly these values, so the two agree until an operator tunes
 * them.
 */
export function penaltyScoreDelta(card: PenaltyCard): number {
  return card === 'red' ? -1 : 0;
}

export function penaltyCausesMatchForfeit(card: PenaltyCard): boolean {
  return card === 'black';
}

/**
 * Which card this offence earns, given what the fighter already has.
 *
 * THE ESCALATION IS THE `sanctions` ARRAY. An entry lists the card for a first
 * offence, a second, a third; the nth offence takes the nth entry, and the last
 * one repeats once the list runs out. So a group whose sanctions are
 * `[yellow, yellow, red]` gives a red on the third offence and every one after.
 *
 * Counting only NON-VOIDED, RULESET-SOURCED cards for the SAME registration in
 * the SAME group. A voided card did not happen; a direct card was the referee
 * overriding the catalogue and is not part of that group's ladder.
 */
export function computePenaltySanction(
  entry: PenaltyRulesetEntry,
  existingPenalties: ExistingPenaltyForSanction[],
  registrationId = 'fighter-1',
): PenaltySanctionResult {
  const previousSameGroup = existingPenalties.filter(
    (penalty) =>
      !penalty.voided &&
      penalty.source === 'ruleset' &&
      penalty.registrationId === registrationId &&
      penalty.groupNumber === entry.groupNumber,
  ).length;
  const groupOccurrence = previousSameGroup + 1;
  const card = entry.sanctions[Math.min(groupOccurrence, entry.sanctions.length) - 1];
  if (!card) {
    throw new Error(
      `Penalty entry ${entry.refNumber} has no sanction for occurrence ${groupOccurrence}`,
    );
  }
  return {
    card,
    groupOccurrence,
    scoreDelta: penaltyScoreDelta(card),
    causesMatchForfeit: penaltyCausesMatchForfeit(card),
  };
}

export function computeDirectPenaltySanction(card: PenaltyCard): PenaltySanctionResult {
  return {
    card,
    groupOccurrence: 0,
    scoreDelta: penaltyScoreDelta(card),
    causesMatchForfeit: penaltyCausesMatchForfeit(card),
  };
}
