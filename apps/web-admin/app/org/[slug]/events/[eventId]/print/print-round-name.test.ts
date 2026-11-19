import { describe, expect, it } from 'vitest';
import { createTranslator, getMessages } from '@myclash/i18n';
import { printRoundName } from './print-round-name';

const t = createTranslator(getMessages('en'));

/**
 * Ruling 891: a double-elimination bracket carries no round count, and the print pack's own
 * namer counted back from it, so its rounds printed as "Final", "Round of 1", "Round of 0.5".
 * The names now come from the same token as the bout codes and the bracket's column headers.
 */
describe('printRoundName', () => {
  it('names each round of a double elimination by its bracket', () => {
    // 8 fighters: 3 winners rounds, 4 losers rounds, the grand final, then its reset.
    const shape = { bracketSize: 8, wbRounds: 3, lbRounds: 4 };
    const names = [1, 2, 3, 4, 7, 8, 9].map((round) => printRoundName(round, shape, t));
    expect(names).toEqual([
      'Winners Quarter Final',
      'Winners Semi Final',
      'Winners Final',
      'Losers Round 1',
      'Losers Round 4',
      'Grand Final',
      'Grand Final Reset',
    ]);
  });

  it('names a single elimination as its column headers do', () => {
    const shape = { bracketSize: 16, wbRounds: null, lbRounds: null };
    expect([1, 2, 3, 4].map((round) => printRoundName(round, shape, t))).toEqual([
      'Round of 16',
      'Quarter Finals',
      'Semi Finals',
      'Finals',
    ]);
  });

  it('names a play-in round', () => {
    const shape = { bracketSize: 8, wbRounds: null, lbRounds: null };
    expect(printRoundName(0, shape, t)).toBe('Play-in');
  });
});
