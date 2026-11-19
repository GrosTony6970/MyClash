import { bracketToken } from '@myclash/types';
import { roundColumnLabel, type RoundTranslator } from '@myclash/ui';
import type { BracketShape } from './build-print-data';

/**
 * A bracket round's name on paper, from the same token the bout codes and the bracket's column
 * headers use (`bracketToken`, `roundColumnLabel`), so the three cannot name a round differently.
 *
 * The private namer it replaces counted back from `rounds`, which a double-elimination phase
 * does not carry (the read sends 0): its rounds printed as "Final", "Round of 1", "Round of 0.5"
 * (ruling 891). The token knows the winners and losers brackets and the grand final.
 */
export function printRoundName(round: number, shape: BracketShape, t: RoundTranslator): string {
  const token = bracketToken({
    bracketRound: round,
    bracketSize: shape.bracketSize,
    wbRounds: shape.wbRounds,
    lbRounds: shape.lbRounds,
  });
  // Every token `bracketToken` emits has a label; a round it cannot place still gets a name.
  return roundColumnLabel(token, t) ?? t('common.round.bracketRound', { n: round });
}
