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

export const DEFAULT_MATCH_FORMAT_CONFIG: MatchFormatConfig = {
  pointCap: 5,
  scoringDirection: 'normal',
  timerMode: 'countdown',
  timeLimitsSeconds: {
    pool: 180,
    bracket: 180,
    finals: 180,
  },
  softClockLimitSeconds: 0,
  maxDoubleHits: null,
  maxDoubleHitOutcome: 'double_loss_zero_scores',
};

export interface TournamentDisplayConfig {
  sideColors: {
    red: TournamentSideColor;
    blue: TournamentSideColor;
  };
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
