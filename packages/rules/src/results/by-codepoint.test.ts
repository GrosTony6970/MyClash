import { describe, expect, it } from 'vitest';
import { byCodepoint } from './by-codepoint';
import { aggregateClubStandings } from './league-club-standings';

/**
 * The point of this key is that it does NOT depend on where it runs.
 *
 * A single-locale run cannot see that: `localeCompare` and `byCodepoint` agree
 * on plain ASCII, and they agree on accents too under whichever collation the
 * runner happens to have. The comparison that separates them is the same pair
 * `standings.ts` and `league-scoring.ts` both cite — `Ähtäri` against `Zoe` —
 * read under two locales that disagree about it.
 *
 * Both locales are asserted inside ONE test. Split across two, a runner whose
 * ICU data is missing would red the wrong half and the failure would read as an
 * environment problem rather than a pinning one.
 */
describe('byCodepoint does not depend on the runtime locale', () => {
  const ACCENTED = 'Ähtäri';
  const PLAIN = 'Zoe';

  it('orders the same pair identically under en and sv, where localeCompare does not', () => {
    // First: prove the pair actually IS the disagreement. If a runner's ICU data
    // ever stops distinguishing these, this test would otherwise pass while
    // proving nothing.
    const enSaysAccentedFirst = ACCENTED.localeCompare(PLAIN, 'en') < 0;
    const svSaysAccentedFirst = ACCENTED.localeCompare(PLAIN, 'sv') < 0;
    expect(
      enSaysAccentedFirst,
      'en must sort Ä before Z, or this test is not testing anything',
    ).toBe(true);
    expect(svSaysAccentedFirst, 'sv must sort Ä after Z, or the locales agree').toBe(false);

    // The key itself has one answer, and it is the code-point one: 'Ä' (U+00C4)
    // is above 'Z' (U+005A), so the accented name comes last.
    expect(byCodepoint(ACCENTED, PLAIN)).toBeGreaterThan(0);
    expect(byCodepoint(PLAIN, ACCENTED)).toBeLessThan(0);
    expect(byCodepoint(ACCENTED, ACCENTED)).toBe(0);
  });

  it('is what orders clubs that are level on every counted key', () => {
    // The aggregator reads ranking rows as PostgREST hands them over, embed and
    // all — not contributions.
    const rankingRow = (fighterId: string, clubId: string, clubName: string) => ({
      total_points: 10,
      medal_count: 0,
      global_person_id: fighterId,
      global_persons: {
        display_name: fighterId,
        clubs: { id: clubId, name: clubName, city: null },
      },
    });

    const result = aggregateClubStandings([
      // Accented FIRST in input order, so a comparison that did nothing at all
      // would leave it first and fail the assertion.
      rankingRow('gp-1', 'c-a', ACCENTED),
      rankingRow('gp-2', 'c-b', PLAIN),
    ]);

    // Level on points, member count and medals, so the name key decides — and it
    // must decide by code point, putting the accented club last in every locale.
    expect(result.clubs.map((club) => club.name)).toEqual([PLAIN, ACCENTED]);
  });
});
