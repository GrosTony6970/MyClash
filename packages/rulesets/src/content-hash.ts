/**
 * Canonical serialization for ruleset content-hash identity.
 *
 * The content hash fingerprints a tournament's EFFECTIVE scoring behaviour — the
 * things that actually decide a score/placing — not just its (code, version).
 * Two TF_v1 tournaments with different winBonus resolve to the identical coded
 * engine yet score differently, so the fingerprint folds in the effective config
 * (grammar + end-conditions + ranking + afterblowMode), paired with the penalty
 * definition (see canonicalizePenaltyDefinition).
 *
 * This module is PURE and dependency-free (no node:crypto, no @myclash/types) so
 * it can run in browser/offline contexts. It produces a canonical OBJECT; the
 * caller turns it into a stable string via {@link stableStringify} and hashes
 * that (sha256 lives in the API, which owns node:crypto).
 */
import { normalizeMatchFormatConfig } from './match-format';

/** Grammar bucket — what an exchange can be and is worth. */
export interface ScoringGrammarInput {
  targets: ReadonlyArray<{ name: string; value: number }> | null;
  hasAfterblow: boolean;
  afterblowValuation: 'fixed' | 'weighted' | null;
  afterblowFixedValue: number | null;
}

/** Coded ruleset (TF_v1 / a coded fork): the maths is CODE, identified by the
 *  engine (code, version); the score-determining parameters live in config. */
export interface CodedScoringBehaviour {
  kind: 'coded';
  engineCode: string;
  engineVersion: string;
  grammar: ScoringGrammarInput;
  matchFormat: Record<string, unknown> | null;
  afterblowMode: string | null;
  /** Tournament-level placing policy (e.g. forfeitDrawsCount) — not a ruleset
   *  constant but it changes the W/L/D tally and thus placings. */
  tournamentPolicy: unknown;
  winBonus: number | null;
  doublePenaltyFormula: unknown;
  forfeitPolicy: unknown;
}

/** Formula ruleset: the maths IS data (an AST + constants + tiebreakers). */
export interface FormulaScoringBehaviour {
  kind: 'formula';
  grammar: ScoringGrammarInput;
  matchFormat: Record<string, unknown> | null;
  afterblowMode: string | null;
  tournamentPolicy: unknown;
  scoreFormula: unknown;
  constants: Record<string, number>;
  tiebreakers: ReadonlyArray<{ variable: string; direction: 'asc' | 'desc' }>;
  doublePenaltyFormula: unknown;
}

export type ScoringBehaviourInput = CodedScoringBehaviour | FormulaScoringBehaviour;

/** Grammar canonical: targets sorted by name (order is not behaviour), afterblow
 *  fields normalised to null when absent. */
function canonicalizeGrammar(grammar: ScoringGrammarInput): Record<string, unknown> {
  const targets = grammar.targets
    ? [...grammar.targets]
        .map((target) => ({ name: target.name, value: target.value }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    : null;
  return {
    targets,
    hasAfterblow: grammar.hasAfterblow,
    afterblowValuation: grammar.afterblowValuation ?? null,
    afterblowFixedValue: grammar.afterblowFixedValue ?? null,
  };
}

/**
 * Project an effective scoring behaviour into a canonical object ready for
 * {@link stableStringify}. The coded/formula split is preserved in `kind` so a
 * coded ruleset and a formula ruleset can never collide, and each kind carries
 * only the fields that decide its score.
 */
export function canonicalizeScoringBehaviour(
  input: ScoringBehaviourInput,
): Record<string, unknown> {
  const shared = {
    grammar: canonicalizeGrammar(input.grammar),
    // Normalise via the SAME normalizer the scorer uses (defaults + legacy
    // aliases resolved), so 'field absent' and 'explicit default' — which score
    // identically — also hash identically.
    matchFormat: normalizeMatchFormatConfig(input.matchFormat ?? {}),
    afterblowMode: input.afterblowMode ?? null,
    tournamentPolicy: input.tournamentPolicy ?? null,
  };
  if (input.kind === 'coded') {
    return {
      kind: 'coded',
      engine: `${input.engineCode}@${input.engineVersion}`,
      ...shared,
      winBonus: input.winBonus ?? null,
      doublePenaltyFormula: input.doublePenaltyFormula ?? null,
      forfeitPolicy: input.forfeitPolicy ?? null,
    };
  }
  return {
    kind: 'formula',
    ...shared,
    scoreFormula: input.scoreFormula ?? null,
    constants: { ...input.constants },
    tiebreakers: input.tiebreakers.map((tie) => ({
      variable: tie.variable,
      direction: tie.direction,
    })),
    doublePenaltyFormula: input.doublePenaltyFormula ?? null,
  };
}

/** The score-determining fields of a penalty ruleset (parent + N entries).
 *  Display fields (name, short_name, description) and sort_order are excluded —
 *  a rename or reorder must NOT change identity. */
export interface PenaltyBehaviourInput {
  accumulationScope: string;
  yellowCardPoints: number;
  redCardPoints: number;
  blackCardPoints: number;
  firstBlackCardForfeit: string;
  secondBlackCardForfeit: string;
  entries: ReadonlyArray<{
    groupNumber: number;
    refNumber: string;
    /** Ordered sanction ladder — sanctions[occurrence] escalates, so order is
     *  behaviour and is preserved. */
    sanctions: ReadonlyArray<string>;
  }>;
}

/**
 * Canonicalise a penalty ruleset's scoring behaviour. Entries are ordered by
 * (groupNumber, refNumber) — the stable behaviour key (ref_number is UNIQUE per
 * ruleset) — so a sort_order reshuffle doesn't change identity; each entry's
 * sanction ladder keeps its order.
 */
export function canonicalizePenaltyDefinition(
  input: PenaltyBehaviourInput,
): Record<string, unknown> {
  const entries = input.entries
    .map((entry) => ({
      groupNumber: entry.groupNumber,
      refNumber: entry.refNumber,
      sanctions: [...entry.sanctions],
    }))
    .sort(
      (a, b) =>
        a.groupNumber - b.groupNumber ||
        (a.refNumber < b.refNumber ? -1 : a.refNumber > b.refNumber ? 1 : 0),
    );
  return {
    accumulationScope: input.accumulationScope,
    cardPoints: {
      yellow: input.yellowCardPoints,
      red: input.redCardPoints,
      black: input.blackCardPoints,
    },
    blackCardForfeit: { first: input.firstBlackCardForfeit, second: input.secondBlackCardForfeit },
    entries,
  };
}

/**
 * Deterministic JSON: object keys sorted, array order preserved, primitives via
 * JSON.stringify (undefined → null). Two semantically-identical objects that
 * differ only in key insertion order produce the identical string, so the hash
 * is stable. NaN/Infinity serialise to null (they are rejected upstream anyway).
 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
