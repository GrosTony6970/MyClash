import { formatRoundCode } from '@myclash/types';

/**
 * Single canonical wrapper around `formatRoundCode` so every backend
 * mapper that returns a match shape (`getMatchSummary`,
 * `listPoolsWithMatches`, `staff.service.mapDisplayMatch /
 * mapSummaryMatch`, …) builds the same `roundCode` from the same row
 * inputs. Two surfaces previously diverged — pool list re-formatted
 * client-side, scoreboard returned the raw label — leaving the same
 * match readable as two different identifiers.
 *
 * The helper takes a view-row-like shape and forwards to the shared
 * pure formatter in `@myclash/types`. Match number falls back to
 * `round_number` when `match_number_label` is null (the historical
 * default for placeholder bracket rows).
 */
export interface RoundCodeRowInput {
  weapon: string | null;
  poolNumber: number | null;
  bracketRound: number | null;
  bracketSize: number | null;
  matchNumberLabel: string | null;
  roundNumber: number | null;
  /**
   * Double-elim round split from `phases.config_json`. Absent for single-elim
   * phases, which keeps their codes byte-identical. Present, it switches the
   * label to the section-aware form (WBF / LB3 / GF) — a double-elim bracket
   * has three rounds that a single-elim label would all call "F".
   */
  wbRounds?: number | null;
  lbRounds?: number | null;
}

export function buildRoundCode(input: RoundCodeRowInput): string {
  return formatRoundCode({
    weapon: input.weapon,
    poolNumber: input.poolNumber,
    bracketRound: input.bracketRound,
    bracketSize: input.bracketSize,
    matchNumber: input.matchNumberLabel ?? input.roundNumber,
    wbRounds: input.wbRounds ?? null,
    lbRounds: input.lbRounds ?? null,
  });
}

/**
 * Pull the round-code-relevant bits out of a `phases.config_json` blob.
 * One reader, so every mapper that builds a round code resolves the bracket
 * shape the same way instead of each picking its own subset of the config.
 */
export function bracketCodeConfig(configJson: unknown): {
  bracketSize: number | null;
  wbRounds: number | null;
  lbRounds: number | null;
} {
  const c = (configJson ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  return {
    bracketSize: num(c['bracketSize']),
    wbRounds: num(c['wbRounds']),
    lbRounds: num(c['lbRounds']),
  };
}
