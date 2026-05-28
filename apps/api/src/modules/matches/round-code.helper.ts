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
}

export function buildRoundCode(input: RoundCodeRowInput): string {
  return formatRoundCode({
    weapon: input.weapon,
    poolNumber: input.poolNumber,
    bracketRound: input.bracketRound,
    bracketSize: input.bracketSize,
    matchNumber: input.matchNumberLabel ?? input.roundNumber,
  });
}
