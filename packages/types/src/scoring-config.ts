/**
 * scoring-config.ts — Tournament scoring configuration types
 *
 * Shared between API, scoring app, and admin app.
 */

import type { AfterblowMode, MatchFormatConfig, ScoringDirection, TimerMode } from '@myclash/rules';

// Afterblow netting moved to @myclash/rules, the zero-dependency core both
// this package and @myclash/rulesets can reach. Re-exported so no caller of
// @myclash/types changed. See packages/rules/src/afterblow.ts for why the two
// former copies existed and what removed the reason.
// MatchFormatConfig had TWO owners: this hand-written interface and
// `z.infer<typeof MatchFormatConfigSchema>` in @myclash/rulesets. They were
// structurally identical and nothing checked that they stayed so; each consumer
// picked whichever package it could already import. The shape now lives in
// @myclash/rules and the schema asserts against it at compile time.
export type { AfterblowMode, MatchFormatConfig, ScoringDirection, TimerMode };

export const TOURNAMENT_SIDE_COLORS = [
  'white',
  'black',
  'grey',
  'yellow',
  'red',
  'blue',
  'green',
  'brown',
  'pink',
  'orange',
  'purple',
] as const;

export type TournamentSideColor = (typeof TOURNAMENT_SIDE_COLORS)[number];

/**
 * The default match format — the ONE copy, and the fallback clients use when a
 * tournament carries no config.
 *
 * There were two: this literal, and `MatchFormatConfigSchema.parse({})` in
 * `@myclash/rulesets`. They had drifted — this copy said pointCap 5 / 180s /
 * softClock 0 / maxDoubleHits null while the schema said 10 / 90s / 5 / 4 — so
 * the scoring pad's fallback disagreed with what the engine seeds into every
 * tournament, and nothing noticed because no package could see both.
 *
 * The literal is the owner and the schema now imports it, because this is the
 * side the pad must reach: `@myclash/types` has no zod on its import path and
 * `@myclash/rulesets` does. The schema's defaults still have to PRODUCE these
 * values, and `packages/rulesets/src/match-format.test.ts` is where that is
 * asserted — parse an empty config, compare against this.
 */
export const DEFAULT_MATCH_FORMAT_CONFIG: MatchFormatConfig = {
  pointCap: 10,
  scoringDirection: 'normal',
  timerMode: 'countdown',
  timeLimitsSeconds: {
    pool: 90,
    bracket: 90,
    finals: 90,
  },
  softClockLimitSeconds: 5,
  maxDoubleHits: 4,
  maxDoubleHitOutcome: 'double_loss_zero_scores',
  bestOf: { pool: 1, bracket: 1, finals: 1 },
};

export interface TournamentDisplayConfig {
  sideColors: {
    red: TournamentSideColor;
    blue: TournamentSideColor;
  };
  /**
   * Ruleset-entry `ref_number`s pinned (in admin) as quick-pick penalty chips
   * on the scoreboard. Keyed by ref_number so pins survive ruleset-version
   * bumps; the scoreboard skips any ref that no longer exists.
   */
  quickPenalties?: number[];
}

export interface CleanButton {
  /** Display label, e.g. "+2" */
  label: string;
  /** Points awarded to the striker */
  value: number;
  /** Whether this button is shown in the scoring UI */
  visible: boolean;
}

export interface AfterblowButton {
  /** Display label, e.g. "2-1" */
  label: string;
  /** Points awarded to the first striker (attacker) */
  attackerPts: number;
  /**
   * Points awarded to the defender in 'full' mode. In 'deductive' mode the
   * defender always gets 0 and this value is instead deducted from the
   * attacker (see {@link computeAfterblowDeltas}).
   */
  defenderPts: number;
  /** Whether this button is shown in the scoring UI */
  visible: boolean;
}

export interface ScoringButtonConfig {
  clean: CleanButton[];
  afterblow: AfterblowButton[];
}

export interface TournamentScoringConfig {
  /** How afterblow points are applied */
  afterblowMode: AfterblowMode;
  /** Configurable score entry buttons */
  buttons: ScoringButtonConfig;
  /** Non-ruleset display configuration used by scoring/public screens */
  display: TournamentDisplayConfig;
}

export interface TournamentLockConfig {
  autoLockEnabled: boolean;
  autoLockDelayMinutes: number;
  autoLockCompletedPools: boolean;
  autoLockCompletedBrackets: boolean;
}

export const DEFAULT_TOURNAMENT_LOCK_CONFIG: TournamentLockConfig = {
  autoLockEnabled: true,
  autoLockDelayMinutes: 15,
  autoLockCompletedPools: true,
  autoLockCompletedBrackets: true,
};

/** Default config — matches TF_v1 standard */
export const DEFAULT_SCORING_CONFIG: TournamentScoringConfig = {
  // Deductive: FFAMHE nets the retaliation against the attacker. This is the
  // federal fallback for a null config; TF_v1's seed default matches it.
  afterblowMode: 'deductive',
  buttons: {
    clean: [
      { label: '+2', value: 2, visible: true },
      { label: '+1', value: 1, visible: true },
    ],
    afterblow: [
      { label: '2-1', attackerPts: 2, defenderPts: 1, visible: true },
      { label: '1-1', attackerPts: 1, defenderPts: 1, visible: true },
    ],
  },
  display: {
    sideColors: {
      red: 'red',
      blue: 'blue',
    },
  },
};

export { computeAfterblowDeltas } from '@myclash/rules';

/**
 * The point-cap winner and the scoring-direction transform, from the one place
 * they are implemented.
 *
 * `pointCapWinnerSide(red, blue, config)` used to live here and was byte-identical
 * to `pointCapWinnerColor` in `@myclash/rules` behind a different parameter
 * shape — two numbers rather than the score object every caller already holds.
 * A comment was the only thing pairing them.
 */
export { applyScoringDirection, pointCapWinnerColor } from '@myclash/rules';

// ── Deriving the scoring buttons from a ruleset's grammar ────────────────────

/**
 * How an afterblow is worth points.
 *
 *  - `fixed`    — the retaliation is always worth the same, whatever it landed
 *                 on. FFAMHE's convention: its published results carry `1-1`
 *                 and `2-1` columns and no `2-2`, and every afterblow stat
 *                 bucket in the database keys on `first_strike_value`, never on
 *                 `afterblow_value`.
 *  - `weighted` — the retaliation is worth the target it hit, so the grid is
 *                 the full attacker x defender product.
 *
 * `RulesetMetadata.afterblowValuation` in @myclash/rulesets is this type — it
 * used to be a second hand-written copy of the union, on the claim that neither
 * package may import the other. That was never true in this direction:
 * @myclash/rulesets already depends on @myclash/types, and only the reverse
 * edge is forbidden. A drift guard in the API asserted the two copies stayed
 * identical; the import makes them one, so the guard is gone.
 */
export type AfterblowValuation = 'fixed' | 'weighted';

/** What a ruleset declares about what an exchange can be and what it is worth. */
export interface ScoringGrammar {
  targets: ReadonlyArray<{ name: string; value: number }>;
  hasAfterblow: boolean;
  afterblowValuation: AfterblowValuation;
  /** The retaliation's worth under `fixed` valuation. Ignored when weighted. */
  afterblowFixedValue: number;
}

/**
 * Derive a tournament's scoring buttons from its ruleset's grammar.
 *
 * This is what stops the pad being a hardcoded pair. The button values were
 * `+2 / +1` and `2-1 / 1-1` constants in DEFAULT_SCORING_CONFIG, which happened
 * to agree with TF_v1's targets by coincidence rather than by derivation — so a
 * federation with different targets got FFAMHE's buttons.
 *
 * Author order is preserved rather than sorted: the operator controls the order
 * of their own targets, and the pad should show what they arranged.
 *
 * Note the afterblow list is returned EMPTY (not omitted) for a ruleset without
 * afterblow. An empty array survives `ensureButtonArray`, whereas a missing key
 * gets DEFAULT_SCORING_CONFIG's `2-1 / 1-1` pair injected on the next PATCH —
 * handing afterblow buttons to a ruleset that has no afterblow.
 */
export function buildScoringButtons(grammar: ScoringGrammar): ScoringButtonConfig {
  const clean: CleanButton[] = grammar.targets.map((target) => ({
    label: `+${target.value}`,
    value: target.value,
    visible: true,
  }));

  if (!grammar.hasAfterblow) return { clean, afterblow: [] };

  const afterblow: AfterblowButton[] = [];
  for (const attacker of grammar.targets) {
    const defenderValues =
      grammar.afterblowValuation === 'weighted'
        ? grammar.targets.map((t) => t.value)
        : [grammar.afterblowFixedValue];
    for (const defenderPts of defenderValues) {
      afterblow.push({
        label: `${attacker.value}-${defenderPts}`,
        attackerPts: attacker.value,
        defenderPts,
        visible: true,
      });
    }
  }
  return { clean, afterblow };
}
