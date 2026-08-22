/**
 * afterblow-button.ts — what an afterblow button on the pad SHOWS.
 *
 * Pure: no React, no I/O. Same reason as `scoreboard-clock.ts` — the arithmetic
 * a referee reads before they press must be unit-testable without rendering,
 * and `apps/web-staff/vitest.config.ts` collects `src/**\/*.test.ts` only.
 *
 * ── Why this is its own module ──────────────────────────────────────────────
 * `computeAfterblowDeltas` is one of the functions ARCHITECTURE.md §7.3 puts on
 * the pad's allowlist, precisely so the pad and the server net an afterblow with
 * the SAME function rather than reasoning separately. The pad calls it twice:
 * here, for the button labels, and in `offline/pending-events.ts`, for the
 * provisional score of a queued hit. The second was covered by a test; this one
 * was not, and it is the one the referee reads at the moment of scoring.
 *
 * The hazard it guards: every mode parameter in the engine defaults to `full`
 * while the product default is `deductive`. A path that loses the mode does not
 * throw — it silently prints full-mode labels on a deductive tournament.
 */
import { computeAfterblowDeltas } from '@myclash/types';
import type { AfterblowMode, AfterblowButton } from '@myclash/types';

/** i18n key for the unit shown beside a deductive button's net points. */
export type PointsKey = 'scoring.lice.point' | 'scoring.lice.points';

export interface AfterblowButtonPoints {
  /** Points the first striker keeps, after the mode is applied. */
  attackerDelta: number;
  /** Points the defender scores — always 0 in `deductive`. */
  defenderDelta: number;
  /**
   * `pills` shows two side-coloured totals because BOTH fighters score.
   * `net` shows the button label plus the single total the striker keeps.
   */
  layout: 'pills' | 'net';
  /** Singular vs plural for `attackerDelta`, resolved by the caller through `t()`. */
  pointsKey: PointsKey;
}

/**
 * Resolve one afterblow button against the tournament's mode.
 *
 * The mode is REQUIRED and has no default — that is the whole point. See the
 * module docblock.
 */
export function afterblowButtonPoints(
  mode: AfterblowMode,
  button: Pick<AfterblowButton, 'attackerPts' | 'defenderPts'>,
): AfterblowButtonPoints {
  const { attackerDelta, defenderDelta } = computeAfterblowDeltas(
    mode,
    button.attackerPts,
    button.defenderPts,
  );

  return {
    attackerDelta,
    defenderDelta,
    layout: mode === 'full' ? 'pills' : 'net',
    pointsKey: attackerDelta === 1 ? 'scoring.lice.point' : 'scoring.lice.points',
  };
}
