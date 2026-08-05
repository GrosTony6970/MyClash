/**
 * match-clock.ts — how a match clock READS on a scoreboard.
 *
 * One owner for the numeral every scoreboard shows: the phase time limit it
 * counts against, whether it counts down or up, and how it is formatted. Pure
 * functions, no React, no zod — so the pad, the admin preview and the projector
 * can all render the same clock without a shared component.
 *
 * This logic used to live in three divergent copies:
 *   - `apps/web-scoring/src/components/scoreboard-clock.ts` — correct except it
 *     billed a Swiss bout at the BRACKET limit.
 *   - `packages/ui/src/components/MatchScoreboard.tsx` — hardcoded
 *     `timeLimitsSeconds.bracket`, so pool and finals showed the wrong limit.
 *   - `packages/ui/src/components/TVScoreboard.tsx` — no countdown at all; the
 *     public projector always counted up, whatever the organiser configured.
 *
 * ── Duplication with @myclash/rulesets, on purpose ────────────────────────────
 * {@link effectiveTimeLimitSeconds} mirrors `getEffectiveMatchTimeLimitSeconds`
 * and {@link isMedalMatchLabel} mirrors `isMedalMatch`, both in
 * `@myclash/rulesets` (match-format.ts). Same reasoning as
 * {@link DEFAULT_MATCH_FORMAT_CONFIG}: the engine is deliberately
 * dependency-free (zod only), so `@myclash/types` must not import it — that edge
 * would drag the engine into every app's Docker build via `@myclash/ui`.
 *
 * The engine is canonical, because the engine is what actually ENDS the match:
 * a display that disagrees is showing a referee a clock nobody will honour.
 * Drift fails in `apps/api/src/match-clock-parity.test.ts`, which is the one
 * place that can see both packages at once.
 */
import type { MatchFormatConfig } from './scoring-config';

/** `phases.type` — the four values the DB CHECK constraint allows. */
export type PhaseType = 'pool' | 'single_elim' | 'double_elim' | 'swiss';

/**
 * Medal matches are identified by their label, not their bracket round: a
 * bronze match sits in the same round as nothing else, and the finals time
 * limit is configured separately from the rest of the bracket.
 */
export function isMedalMatchLabel(label: string | null | undefined): boolean {
  const normalized = (label ?? '').trim().toUpperCase();
  return ['F', 'FINAL', 'GOLD', 'GOLD MEDAL MATCH', '3RD', 'BRONZE', 'BRONZE MEDAL MATCH'].includes(
    normalized,
  );
}

/**
 * The time limit this match counts against, in seconds. `null` = no limit
 * (the clock can only count up).
 *
 * Mirrors the engine's dispatch exactly, including the Swiss rule: `swiss ??
 * pool` and NOT `?? bracket`, because a Swiss round is a group stage and a
 * config written before Swiss existed carries no `swiss` key at all.
 */
export function effectiveTimeLimitSeconds(
  matchFormat: MatchFormatConfig,
  phaseType: PhaseType | undefined,
  matchNumberLabel: string | null | undefined,
): number | null {
  if (phaseType === 'pool') return matchFormat.timeLimitsSeconds.pool;
  if (phaseType === 'swiss') {
    return matchFormat.timeLimitsSeconds.swiss ?? matchFormat.timeLimitsSeconds.pool;
  }
  if (isMedalMatchLabel(matchNumberLabel)) return matchFormat.timeLimitsSeconds.finals;
  return matchFormat.timeLimitsSeconds.bracket;
}

/**
 * Raw elapsed active ms → the value to put on the scoreboard. Countdown
 * subtracts from the phase limit and clamps at zero; count-up (or a phase with
 * no limit) returns elapsed unchanged.
 */
export function displayClockMs(
  elapsedMs: number,
  matchFormat: MatchFormatConfig,
  phaseType: PhaseType | undefined,
  matchNumberLabel: string | null | undefined,
): number {
  if (matchFormat.timerMode === 'countup') return Math.max(0, elapsedMs);
  const limitSeconds = effectiveTimeLimitSeconds(matchFormat, phaseType, matchNumberLabel);
  if (limitSeconds === null) return Math.max(0, elapsedMs);
  return Math.max(0, limitSeconds * 1000 - elapsedMs);
}

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
