import { getEffectiveVenuesPerRound, type MatchFormatConfig, type PhaseType } from '@myclash/types';

/**
 * The "Venues 3/5" counter the pad header shows: the venues won in the open round over the
 * venues a round runs to. Null in a points bout, which has no venues to count.
 */
export function venuesCounterOnPad(
  match: { phaseType?: PhaseType | null; matchNumberLabel: string },
  matchFormat: MatchFormatConfig,
  won: number,
): { won: number; total: number } | null {
  if (matchFormat.scoringUnit !== 'venues') return null;
  return {
    won,
    total: getEffectiveVenuesPerRound(
      { phaseType: match.phaseType ?? undefined, matchNumberLabel: match.matchNumberLabel },
      matchFormat,
    ),
  };
}

/**
 * The point cap the scoring columns print beside a score (`12 / 15`). A venues bout has no cap to
 * reach, so it prints none.
 */
export function padPointCap(matchFormat: MatchFormatConfig): number | undefined {
  return matchFormat.scoringUnit === 'venues' ? undefined : matchFormat.pointCap;
}
