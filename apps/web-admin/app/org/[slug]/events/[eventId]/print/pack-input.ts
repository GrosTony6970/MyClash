import { sideColorsFor } from '@myclash/ui';
import { allMatchesOf, bracketToPrint, poolsToPrint } from './build-print-data';
import type { PrintPackInput, PrintSectionKey } from './print-pack';
import type { PrintLabels } from './print-types';
import type { TournamentPack } from './usePrintPackData';

export interface PackContext {
  eventName: string;
  /** The EVENT's zone: every clock the pack prints belongs to the hall. */
  timeZone: string;
  generatedAt: string;
  lices: ReadonlyMap<string, string>;
  roundName: (round: number, rounds: number) => string;
  labels: PrintLabels;
  sections: readonly PrintSectionKey[];
}

/** What one Tournament's reads print as. Pure: the page reads, this draws. */
export function packInput(pack: TournamentPack, context: PackContext): PrintPackInput {
  const { detail, bracket } = pack;
  const pools = poolsToPrint(pack.pools, context.lices, context.labels.unknownReferee);
  const bracketRounds = bracket
    ? bracketToPrint(bracket.slots, bracket.rounds, context.lices, context.roundName)
    : [];
  return {
    meta: {
      eventName: context.eventName,
      tournamentName: detail.name,
      rulesetLabel: `${detail.ruleset_code ?? ''} ${detail.ruleset_version ?? ''}`.trim(),
      // The organiser's configured corners, resolved for a white page — never
      // a hardcoded red/blue. Across a hall the corner colour is the only
      // thing a spectator can read, and paper has to agree with the screen.
      sideColors: sideColorsFor(detail.scoring_config_json ?? null, 'light'),
      generatedAt: context.generatedAt,
      timeZone: context.timeZone,
    },
    labels: context.labels,
    pools,
    bracketRounds,
    allMatches: allMatchesOf(pools, bracketRounds),
    sections: context.sections,
  };
}
