/**
 * The TF_v1 ranking score, and the aggregates it reads.
 *
 * SCORE = (wins x winBonus + targetPoints) / (timesHit + doublePenalty(doubles))
 * ARCHITECTURE.md 6.1 and 6.2.
 *
 * ── What stayed behind ──────────────────────────────────────────────────────
 * `computeMatchScore` and `isMatchOver` are `Ruleset` CONTRACT methods, and the
 * contract hands them an unvalidated config blob which they must normalise
 * before use. Normalising is resolution, so it needs zod, so those two remain in
 * `@myclash/rulesets`. Everything below is application: give it aggregates or
 * exchanges and it answers with no schema, no registry and no database.
 *
 * The afterblow mode is threaded, not defaulted, wherever it reaches this file.
 * Covered end to end in both modes by
 * `packages/rulesets/test/tf_v1.afterblow-golden.test.ts`.
 */
import { computeAfterblowDeltas, type AfterblowMode } from '../afterblow';
import type { Exchange, Match } from '../domain';
import { doublePenalty, type DoublePenaltySpec } from './double-penalty';

export const WIN_BONUS = 3;

// ── Per-fighter aggregates ────────────────────────────────────────────────────

export interface FighterAggregates {
  wins: number;
  targetPoints: number;
  timesHit: number;
  doubles: number;
}

/**
 * Compute per-fighter aggregates from non-voided exchanges.
 * ARCHITECTURE.md §6.1.
 *
 * `match` is narrowed to the one field this reads. It used to take a whole
 * `Match`, which meant the API's standings builder -- holding PostgREST rows,
 * not domain objects -- had to invent one with `as unknown as Match` and a
 * comment explaining that only two fields were needed. A signature that asks
 * for what it uses removes both.
 */
export function computeAggregates(
  registrationId: string,
  match: Pick<Match, 'redRegistrationId'>,
  exchanges: Exchange[],
  isWinner: boolean,
  afterblowMode: AfterblowMode = 'full',
): FighterAggregates {
  const isRed = match.redRegistrationId === registrationId;
  const myColor = isRed ? 'red' : 'blue';
  const opponentColor = isRed ? 'blue' : 'red';

  const active = exchanges.filter((e) => !e.voided);

  let targetPoints = 0;
  let timesHit = 0;
  let doubles = 0;

  for (const ex of active) {
    switch (ex.type) {
      case 'clean':
        if (ex.firstStrikerColor === myColor) {
          // I struck first (clean hit) → I gain first_strike_value
          targetPoints += ex.firstStrikeValue ?? 0;
        } else if (ex.firstStrikerColor === opponentColor) {
          // Opponent struck me → I was hit
          timesHit += 1;
        }
        break;

      case 'afterblow': {
        // Raw button values are stored; the mode decides how they net. In
        // 'deductive' the afterblow is subtracted from the attacker and the
        // afterblow-lander gains 0.
        const { attackerDelta, defenderDelta } = computeAfterblowDeltas(
          afterblowMode,
          ex.firstStrikeValue ?? 0,
          ex.afterblowValue ?? 0,
        );
        if (ex.firstStrikerColor === myColor) {
          // I struck first → I gain the (possibly deducted) attacker points
          targetPoints += attackerDelta;
          // NOTE: in afterblow, the FIRST striker receives the afterblow
          // (opponent landed afterblow on me) → I was hit
          timesHit += 1;
        } else if (ex.firstStrikerColor === opponentColor) {
          // Opponent struck first → I landed the afterblow → I gain the
          // defender points (0 in deductive mode)
          targetPoints += defenderDelta;
        }
        break;
      }

      case 'double':
        // Both struck simultaneously — no points, counts toward penalty
        doubles += 1;
        break;

      case 'no_exchange':
        // No score effect
        break;
    }
  }

  return {
    wins: isWinner ? 1 : 0,
    targetPoints,
    timesHit,
    doubles,
  };
}

/**
 * Ranking inputs a ruleset can tune. Both were hardcoded, so a super-admin
 * amending the federal rulebook changed a stored number that nothing read.
 * Omitted values fall back to the federal defaults, so callers that pass
 * nothing (and the FAL 2026 golden test) behave exactly as before.
 */
export interface ScoreOptions {
  winBonus?: number;
  /** Whitelisted key or authored AST — see `double-penalty.ts`. */
  doublePenaltyFormula?: DoublePenaltySpec;
}

/**
 * Compute TF_v1 score for a fighter.
 * ARCHITECTURE.md §6.2:
 *   SCORE = (wins * winBonus + targetPoints) / (timesHit + doublePenalty(doubles))
 *
 * Edge case: if denominator = 0, treat as denominator = 1.
 */
export function computeScore(agg: FighterAggregates, opts: ScoreOptions = {}): number {
  const numerator = agg.wins * (opts.winBonus ?? WIN_BONUS) + agg.targetPoints;
  const denominator = agg.timesHit + doublePenalty(agg.doubles, opts.doublePenaltyFormula);

  // Edge case: denominator = 0 → treat as 1 (ARCHITECTURE.md §6.2)
  if (denominator === 0) {
    return numerator;
  }

  return numerator / denominator;
}

// ── Match score ───────────────────────────────────────────────────────────────

/**
 * Compute the full match score from exchanges.
 * Returns scores for both red and blue.
 */
