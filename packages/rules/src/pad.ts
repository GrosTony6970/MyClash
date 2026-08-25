/**
 * @myclash/rules/pad — the arithmetic a CLIENT may run, and nothing else.
 *
 * ── Why this entry point exists ─────────────────────────────────────────────
 * `@myclash/types` re-exports a handful of values from this package so the
 * scoring pad and the server share one implementation instead of two. Every
 * client imports `@myclash/types` freely, and `packages/ui` — which all three
 * apps bundle — imports it too. So whatever `@myclash/types` reaches for,
 * every app ships.
 *
 * Reaching for the ROOT barrel therefore shipped the whole competition core:
 * the formula evaluator, TF_v1 scoring and the stat derivation all landed in
 * web-staff, web-public and web-admin, none of which call them. This module is
 * the narrow door `@myclash/types` goes through instead.
 *
 * ── What may be added here ─────────────────────────────────────────────────
 * Exactly the values on the `docs/ARCHITECTURE.md` §7.3 allowlist that live in
 * this package. That list is not decoration: `scripts/check-package-purity.mjs`
 * rule 4 parses it and refuses any value reaching a client that is not on it.
 * The three §7.3 entries missing below — `computePenaltySanction`,
 * `penaltyScoreDelta` and `resolveEntryCard` — are not here because they are
 * implemented in `@myclash/types` itself, not in this package.
 *
 * Adding an export here is therefore a two-step act with a gate behind it: put
 * the value on the §7.3 table with its reason, then export it. Adding one to
 * the ROOT barrel instead is what quietly costs every app its bundle headroom.
 *
 * The types below cost nothing — a type erases before the bundler sees it — but
 * they are listed here rather than taken from the root so that `@myclash/types`
 * has exactly one import specifier into this package.
 */

/** Net a queued hit, and label the afterblow buttons. */
export { computeAfterblowDeltas } from './afterblow';
export type { AfterblowMode } from './afterblow';

/**
 * The clock numeral, the phase time limit the bout counts against, the
 * `reverse_zero_loses` read-down, and the gold-score point cap.
 */
export {
  applyScoringDirection,
  displayClockMs,
  effectiveTimeLimitSeconds,
  pointCapWinnerColor,
} from './match-format';

/**
 * The remedy a level bout is waiting on, so the pad can NAME it on the button
 * and know when sudden death is live. The phase dispatch behind it is the one
 * `effectiveTimeLimitSeconds` uses; a second copy on the pad would be a second
 * owner of which chain a medal match reads.
 */
export { pendingLevelStep } from './match-format';

/**
 * Whether the bout's time has run out — so the pad withholds the remedy button
 * until the server would accept it, instead of offering one that 400s.
 */
export { timeIsFinished } from './match-format';
export type { LevelStep, MatchFormatConfig, ScoringDirection, TimerMode } from './match-format';

export type { PhaseType } from './domain';

/**
 * Ranking vocabulary `@myclash/types` re-exports for its own final-ranking and
 * league shapes. Type-only on purpose — a union erases, so these cost a client
 * nothing, and none of the arithmetic that reads them is exported here.
 */
export type {
  FinalRankingResultKind,
  LeagueRankingDimensions,
  SecondChanceTarget,
} from './ranking';
