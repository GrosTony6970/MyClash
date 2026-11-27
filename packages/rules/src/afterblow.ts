/**
 * Afterblow netting — the single owner.
 *
 * ── Why this is the package's first content ─────────────────────────────────
 * This rule had TWO implementations, in `@myclash/types/scoring-config.ts` and
 * `@myclash/rulesets/match-format.ts`, and the reason was never a design one.
 * The rulesets copy said so in its own comment: kept local "so the ruleset
 * engine stays dependency-free (zod only) and isn't pulled into every app
 * Dockerfile's workspace build graph". That is a PACKAGE constraint, not a
 * capability one — the arithmetic below needs nothing at all.
 *
 * A zero-dependency package both sides can depend on removes the reason. Both
 * former copies now re-export from here.
 *
 * ── The invariant ───────────────────────────────────────────────────────────
 * Exchanges store RAW button values. The mode nets them AT READ, from
 * `tournaments.scoring_config_json.afterblowMode`. The tournament is the source
 * of truth, never the ruleset — a ruleset only SEEDS the tournament. If a
 * derivation path ever preferred the ruleset's `defaultAfterblowMode`, changing
 * a ruleset would retroactively rewrite every score ever derived under it.
 *
 * `mode` is therefore required here and has no default. A Tournament that stores
 * no mode plays `full` (`afterblowModeInForce` in @myclash/types, operator ruling
 * 47), but a ruleset such as TF_v1 seeds `deductive` into every Tournament it
 * starts, so a caller that loses the mode does not throw — it silently scores a
 * deductive tournament in full mode.
 */
import type { Exchange } from './domain';
import type { ScoringUnit } from './match-format';

/**
 * How afterblow points are applied.
 *
 * - `full`: both fighters score their button points (attacker, defender).
 * - `deductive`: the afterblow is subtracted from the attacker
 *   (`max(0, attacker − defender)`, never negative) and the defender scores 0 —
 *   getting hit back costs the attacker points.
 */
export type AfterblowMode = 'full' | 'deductive';

/**
 * Net one afterblow exchange's raw button values into the points each side
 * actually scores.
 *
 * Covered end to end, in both modes, by
 * `packages/rulesets/test/tf_v1.afterblow-golden.test.ts`.
 */
export function computeAfterblowDeltas(
  mode: AfterblowMode,
  attackerPts: number,
  defenderPts: number,
): { attackerDelta: number; defenderDelta: number } {
  if (mode === 'deductive') {
    return { attackerDelta: Math.max(0, attackerPts - defenderPts), defenderDelta: 0 };
  }
  return { attackerDelta: attackerPts, defenderDelta: defenderPts };
}

/**
 * What one exchange is worth to each side, and which side it won a venue for.
 *
 * The ONE per-exchange pricer. Three places price an exchange from its button
 * value — the scorer, the server's delta on save, and the pad's queued hit — and
 * venues mode changes that price. Three copies would each have to learn the new
 * rule, and one that did not would log "+2" while the board moved by 1.
 *
 *   points  a clean hit is its button value to the striker; an afterblow nets
 *           through {@link computeAfterblowDeltas}; a double and a no-exchange
 *           are worth nothing — the arithmetic as it always was
 *   venues  a clean hit is 1 to the striker, whatever the button; nothing else
 *           scores, whatever the button values or the afterblow mode
 *
 * `venue` is the striker of a clean hit in BOTH modes, read from the exchange
 * TYPE and never from the deltas: an afterblow scores in points mode and still
 * wins nobody a venue. In points mode the count is simply the clean hits.
 */
export function exchangeDeltas(
  ex: Pick<Exchange, 'type' | 'firstStrikerColor' | 'firstStrikeValue' | 'afterblowValue'>,
  afterblowMode: AfterblowMode,
  unit: ScoringUnit,
): { red: number; blue: number; venue: 'red' | 'blue' | null } {
  const striker = ex.firstStrikerColor;
  if (striker === null) return { red: 0, blue: 0, venue: null };
  // The striker's points and the other side's, as red and blue.
  const sides = (own: number, other: number) =>
    striker === 'red' ? { red: own, blue: other } : { red: other, blue: own };

  if (ex.type === 'clean') {
    const value = unit === 'venues' ? 1 : (ex.firstStrikeValue ?? 0);
    return { ...sides(value, 0), venue: striker };
  }
  // Venues only when it says venues: a format read off an older copy, with no
  // unit, prices as points did.
  if (ex.type === 'afterblow' && unit !== 'venues') {
    const { attackerDelta, defenderDelta } = computeAfterblowDeltas(
      afterblowMode,
      ex.firstStrikeValue ?? 0,
      ex.afterblowValue ?? 0,
    );
    return { ...sides(attackerDelta, defenderDelta), venue: null };
  }
  return { red: 0, blue: 0, venue: null };
}
