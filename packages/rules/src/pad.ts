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

/**
 * The doubles limit the bout is fought under: the format's in a pool and a
 * Swiss round, none in a bracket. The pad shows the limit the server applies.
 */
export { getEffectiveMaxDoubles } from './match-format';

/**
 * The two rules a best-of bout runs on with no network: is this round over by
 * itself on this score (and for whom), and is the series over on these closed
 * rounds. The server closes a round and a series by the same two functions;
 * only the round's SCORE differs (the server's is the ruleset's own scorer's),
 * and the server decides when the two disagree.
 */
export { roundOutcome, seriesResult } from './match-format';
export type { SeriesResult } from './match-format';

/**
 * How far under zero each side went, in a bout that counts down. The board
 * stops at zero; with both fighters out of points these two numbers say who is
 * less far below, and `pointCapWinnerColor` and `roundOutcome` read them. The
 * pad gives it the earned points it already adds for `applyScoringDirection`.
 */
export { belowZero } from './match-format';
export type { CapScore } from './match-format';

/**
 * The end decision the pad asks `roundOutcome` and `pointCapWinnerColor` with,
 * today's for every bout until a Match carries its ruleset version's own.
 */
export { EDITION_2026_10 } from './match-format';
export type { DecisionEdition } from './match-format';

/**
 * Is a name read from the server or the tablet's store an edition the pad
 * knows? An unknown one falls back to `EDITION_2026_10`, said in the console.
 */
export { isDecisionEdition } from './match-format';
export type { LevelStep, MatchFormatConfig, ScoringDirection, TimerMode } from './match-format';

export type { PhaseType } from './domain';

/**
 * The clock after a press the pad still holds: a bout runs with no network,
 * and the pad shows the clock the server will have once the queue is sent.
 */
export { clockAfterPress } from './clock';

/**
 * The correction of the clock a step of extra time gives. The server writes it
 * on the step's row; the pad folds a step it still holds by the same function,
 * so the clock on the tablet is the one the server will have.
 */
export { extraTimeAdjustmentMs } from './clock';
export type { ClockFold, ClockPress, ClockStatus } from './clock';

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
