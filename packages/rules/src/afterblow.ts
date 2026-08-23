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
 * `mode` is therefore required here and has no default. Every mode parameter in
 * the engine defaults to `full` while the product default is `deductive`, so a
 * caller that loses the mode does not throw — it silently scores a deductive
 * tournament in full mode.
 */

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
