import { describe, expect, it } from 'vitest';
import { hemaRatingsRound } from './hema-ratings-format';
import type { SubmissionMatch } from './hema-ratings-submission';
import { match } from './hema-ratings.fixtures';

/**
 * Round naming for the HEMA Ratings submission, one suite per phase type.
 *
 * Split out of hema-ratings-submission.test.ts because this is the one column
 * of the submission whose wrong value cannot be walked back: the file goes to
 * the public hemaratings.com database, and a round accepted there under the
 * wrong name misreports every fighter in it.
 */
describe('hemaRatingsRound', () => {
  it('keeps the pool number rather than collapsing every pool to "Pools"', () => {
    expect(hemaRatingsRound(match({ id: 'm', poolSortOrder: 0 }))).toBe('Pool 1');
    expect(hemaRatingsRound(match({ id: 'm', poolSortOrder: 3 }))).toBe('Pool 4');
    expect(hemaRatingsRound(match({ id: 'm', poolSortOrder: null }))).toBe('Pools');
  });

  it('uses HEMA Ratings vocabulary for single elimination', () => {
    const single = (matchLabel: string) =>
      hemaRatingsRound(match({ id: 'm', phaseType: 'single_elim', matchLabel }));
    expect(single('F')).toBe('Final');
    expect(single('Bronze Final')).toBe('Bronze Final'); // bronze wins over "final"
    expect(single('SF1')).toBe('Semi Final');
    expect(single('QF2')).toBe('Quarter Final');
    expect(single('R16-3')).toBe('Round of 16');
  });

  it('names double-elim rounds from the wb/lb split, ending at Final', () => {
    const de = (bracketRound: number) =>
      hemaRatingsRound(
        match({
          id: 'm',
          phaseType: 'double_elim',
          phaseConfig: { wbRounds: 3, lbRounds: 4 },
          bracketRound,
        }),
      );
    expect(de(0)).toBe('Play-ins');
    expect(de(1)).toBe('Winners Quarter Final');
    expect(de(2)).toBe('Winners Semi Final');
    expect(de(3)).toBe('Winners Final');
    expect(de(4)).toBe('Losers Round 1');
    expect(de(7)).toBe('Losers Round 4');
    expect(de(8)).toBe('Final');
    expect(de(9)).toBe('Final (reset)');
  });

  it('falls back to the match label when the bracket config is missing', () => {
    expect(
      hemaRatingsRound(
        match({ id: 'm', phaseType: 'double_elim', phaseConfig: null, matchLabel: 'GF' }),
      ),
    ).toBe('GF');
  });

  it('names Swiss rounds, and NEVER submits one as an elimination bout', () => {
    const swiss = (over: Partial<SubmissionMatch> = {}) =>
      hemaRatingsRound(match({ id: 'm', phaseType: 'swiss', poolSortOrder: null, ...over }));

    expect(swiss({ swissRound: 1 })).toBe('Swiss Round 1');
    expect(swiss({ swissRound: 5 })).toBe('Swiss Round 5');
    // Degrades to the phase name, not to a knockout label, when the round is
    // unknown — and a stray match label must not win over it either.
    expect(swiss({ swissRound: null })).toBe('Swiss');
    expect(swiss({ swissRound: null, matchLabel: 'SW-R2-M1' })).toBe('Swiss');

    for (const round of [null, 1, 9]) {
      expect(swiss({ swissRound: round })).not.toBe('Elimination');
    }
  });
});
