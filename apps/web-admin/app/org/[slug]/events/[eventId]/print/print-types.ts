/**
 * Shapes and labels the print builders consume.
 *
 * Every builder is pure: data in, an HTML string out. No React, no fetching, no
 * `window`. The page does the fetching and the print-window open, exactly as
 * `finalranking/final-ranking-export.ts` does — that split is what makes the
 * row→markup mapping unit-testable.
 *
 * **Labels are passed in, never hardcoded.** The two existing print helpers put
 * their column headers in English `const` arrays, which is invisible until a
 * French referee is handed a sheet that says "Exchange". Every builder here
 * takes a `labels` object the caller fills from `t()`.
 */

/** One bout, from either a pool or a bracket. */
export interface PrintMatch {
  /** Canonical round code, e.g. `LSW-P1-M1`. Rendered verbatim. */
  roundCode: string;
  redName: string;
  blueName: string;
  redClub: string | null;
  blueClub: string | null;
  /** Human lice name, or null when the bout has not been placed on a piste. */
  liceName: string | null;
  /** Referee display names already resolved. */
  referees: string[];
}

export interface PrintPool {
  poolName: string;
  /** Fighters in the pool, in seed order. */
  fighters: Array<{ name: string; club: string | null }>;
  matches: PrintMatch[];
}

export interface PrintBracketRound {
  /** e.g. "Quarter-finals" — already localized by the caller. */
  roundName: string;
  matches: PrintMatch[];
}

export interface PrintPiste {
  liceName: string;
  matches: PrintMatch[];
}

export interface PrintTournamentMeta {
  eventName: string;
  tournamentName: string;
  /** e.g. "TF_v1 1.0.0". Printed on every sheet so a rules dispute has an anchor. */
  rulesetLabel: string;
  /** The organiser's configured corner colours, resolved for a white page. */
  sideColors: { red: string; blue: string };
  /** ISO timestamp the pack was generated at, pre-formatted by the caller. */
  generatedAt: string;
}

/**
 * Every visible string. Flat rather than nested so a missing one is a type
 * error at the call site instead of an `undefined` rendered onto paper.
 */
export interface PrintLabels {
  poolSheet: string;
  scoresheet: string;
  pisteSheet: string;
  bracketSheet: string;
  fighter: string;
  club: string;
  bout: string;
  piste: string;
  referee: string;
  unassigned: string;
  score: string;
  exchanges: string;
  doubles: string;
  penalties: string;
  winner: string;
  signature: string;
  round: string;
  generatedAt: string;
  red: string;
  blue: string;
  notes: string;
}
