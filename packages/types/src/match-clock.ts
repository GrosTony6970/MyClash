/**
 * match-clock.ts — how a match clock READS on a scoreboard.
 *
 * One owner for the numeral every scoreboard shows: the phase time limit it
 * counts against, whether it counts down or up, and how it is formatted. Pure
 * functions, no React, no zod — so the pad, the admin preview and the projector
 * can all render the same clock without a shared component.
 *
 * This logic used to live in three divergent copies:
 *   - `apps/web-staff/src/components/scoreboard-clock.ts` — correct except it
 *     billed a Swiss bout at the BRACKET limit.
 *   - `packages/ui/src/components/MatchScoreboard.tsx` — hardcoded
 *     `timeLimitsSeconds.bracket`, so pool and finals showed the wrong limit.
 *   - `packages/ui/src/components/TVScoreboard.tsx` — no countdown at all; the
 *     public projector always counted up, whatever the organiser configured.
 *
 * ── It used to be duplicated with the engine, and is not any more ────────────
 * `effectiveTimeLimitSeconds` mirrored `getEffectiveMatchTimeLimitSeconds` and
 * `displayClockMs` mirrored `computeMatchClockMs`, both in `@myclash/rulesets`.
 * The reason was a PACKAGE constraint: the engine sat beside zod, so
 * `@myclash/types` could not import it without dragging zod into every app's
 * Docker build via `@myclash/ui`. `apps/api/src/match-clock-parity.test.ts` was
 * the one place that could see both packages at once, and it existed only to
 * catch the drift.
 *
 * `@myclash/rules` has no dependencies at all, so the constraint is gone and so
 * are both copies: the functions below come from there, and the parity test
 * went with the drift it guarded. What is left here is what the engine has no
 * counterpart for — the warning threshold and the `MM:SS:CC` formatting.
 */
import {
  displayClockMs,
  effectiveTimeLimitSeconds,
  type MatchFormatConfig,
  type PhaseType,
} from '@myclash/rules';

export { displayClockMs, effectiveTimeLimitSeconds };
export type { PhaseType };

/**
 * Whether the clock is inside the last 10 seconds of the phase limit — the cue
 * to paint it red. Independent of `timerMode`: the bout ends at the limit
 * whether or not the scoreboard is counting towards it.
 */
export function shouldWarnClock(
  elapsedMs: number,
  matchFormat: MatchFormatConfig,
  phaseType: PhaseType | undefined,
  matchNumberLabel: string | null | undefined,
): boolean {
  const limitSeconds = effectiveTimeLimitSeconds(matchFormat, phaseType, matchNumberLabel);
  if (limitSeconds === null) return false;
  return Math.max(0, limitSeconds * 1000 - elapsedMs) < 10_000;
}

/** `MM:SS:CC`. Negative input clamps to zero rather than rendering a sign. */
export function formatClockMs(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((clamped % 1000) / 10);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(
    centiseconds,
  ).padStart(2, '0')}`;
}
