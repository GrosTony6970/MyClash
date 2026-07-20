/**
 * scoring-config.ts — Tournament scoring configuration types
 *
 * Shared between API, scoring app, and admin app.
 */

export type AfterblowMode = 'full' | 'deductive';
export type ScoringDirection = 'normal' | 'reverse_zero_loses';
export type TimerMode = 'countdown' | 'countup';

export interface MatchFormatConfig {
  pointCap: number;
  scoringDirection: ScoringDirection;
  timerMode: TimerMode;
  timeLimitsSeconds: {
    pool: number | null;
    bracket: number | null;
    finals: number | null;
  };
  softClockLimitSeconds: number;
  maxDoubleHits: number | null;
  maxDoubleHitOutcome: 'double_loss_zero_scores';
  /**
   * Best-of-N rounds per phase. A match is decided by winning ⌈N/2⌉ rounds.
   * 1 = single round (default everywhere — today's behaviour). Odd values only
   * (1/3/5/7). Mirrors {@link timeLimitsSeconds} so each phase configures
   * independently (e.g. single-round pools, BO3 bracket, BO5 finals).
   */
  bestOf: {
    pool: number;
    bracket: number;
    finals: number;
  };
}
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
 * Fallback match format for clients when a tournament carries no config.
 *
 * These values MUST match `MatchFormatConfigSchema`'s defaults in
 * `@myclash/rulesets` (match-format.ts). They had drifted — this copy said
 * pointCap 5 / 180s / softClock 0 / maxDoubleHits null while the schema said
 * 10 / 90s / 5 / 4 — so the scoring pad's fallback disagreed with what the
 * engine actually seeds into every tournament.
 *
 * The rulesets schema is canonical because it is what `TFv1DefaultConfig`
 * seeds; this copy exists only because `@myclash/types` must not depend on
 * `@myclash/rulesets` (that edge would drag the engine into every app's
 * Docker build via `@myclash/ui`). Duplicated on purpose, kept in step by
 * `default-match-format.test.ts`.
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
  afterblowMode: 'full',
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

/**
 * Compute the actual score deltas for an afterblow exchange, respecting the
 * afterblow mode.
 *
 * - `full`: both fighters score their button points (attacker, defender).
 * - `deductive`: the afterblow is subtracted from the attacker
 *   (`max(0, attackerPts − defenderPts)`, never negative) and the defender
 *   scores 0 — getting hit back costs the attacker points.
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
 * Which side has won by reaching the point cap, or null if neither has yet.
 * Reverse-aware: in `reverse_zero_loses` the side that hits 0 loses, so the
 * winner is its opponent. Mirrors the engine's point-cap winner rule and
 * drives the scoreboard's cap highlight.
 */
export function pointCapWinnerSide(
  redScore: number,
  blueScore: number,
  matchFormat: MatchFormatConfig,
): 'red' | 'blue' | null {
  if (matchFormat.scoringDirection === 'reverse_zero_loses') {
    if (redScore <= 0 && blueScore <= 0) return null;
    if (redScore <= 0) return 'blue';
    if (blueScore <= 0) return 'red';
    return null;
  }
  if (redScore >= matchFormat.pointCap && blueScore >= matchFormat.pointCap) return null;
  if (redScore >= matchFormat.pointCap) return 'red';
  if (blueScore >= matchFormat.pointCap) return 'blue';
  return null;
}

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
 * Mirrors the union on `RulesetMetadata.afterblowValuation` in
 * @myclash/rulesets. Duplicated rather than imported because this package has
 * no dependencies at all and rulesets does not depend on it — the same
 * arrangement `AfterblowMode` already has. A drift guard in the API asserts the
 * two stay identical.
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
