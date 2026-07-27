import { describe, expect, it } from 'vitest';
import {
  hemaGender,
  hemaRatingsRound,
  matchOutcome,
  tournamentFileName,
} from './hema-ratings-format';
import {
  buildSubmission,
  type SubmissionFighter,
  type SubmissionInput,
  type SubmissionMatch,
} from './hema-ratings-submission';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function fighter(overrides: Partial<SubmissionFighter> & { personId: string }): SubmissionFighter {
  return {
    givenName: 'Jean',
    familyName: 'Dupont',
    clubId: null,
    nationality: 'FR',
    genderCategory: null,
    hemaRatingsId: '123',
    ...overrides,
  };
}

function match(overrides: Partial<SubmissionMatch> & { id: string }): SubmissionMatch {
  return {
    redPersonId: 'p1',
    bluePersonId: 'p2',
    winnerPersonId: 'p1',
    endReason: null,
    forfeited: false,
    phaseType: 'pool',
    phaseConfig: null,
    poolSortOrder: 0,
    bracketRound: null,
    matchLabel: null,
    ...overrides,
  };
}

function rowsOf(csv: string): string[][] {
  // Header row is dropped; no fixture here contains a quoted newline.
  return csv
    .split('\n')
    .slice(1)
    .map((line) => line.split(','));
}

// ── matchOutcome ──────────────────────────────────────────────────────────────

describe('matchOutcome', () => {
  it('puts the winner first', () => {
    expect(matchOutcome(match({ id: 'm', winnerPersonId: 'p2' }))).toEqual({
      fighter1PersonId: 'p2',
      fighter2PersonId: 'p1',
      result1: 'Win',
      result2: 'Loss',
    });
  });

  it('records a double loss as a Loss for BOTH fighters, not a draw', () => {
    // matches.end_reason = 'max_doubles' zeroes both scores and leaves no
    // winner; reading that as a draw would misreport it upstream.
    expect(
      matchOutcome(match({ id: 'm', winnerPersonId: null, endReason: 'max_doubles' })),
    ).toEqual({
      fighter1PersonId: 'p1',
      fighter2PersonId: 'p2',
      result1: 'Loss',
      result2: 'Loss',
    });
  });

  it('records a genuine tie as a draw', () => {
    expect(matchOutcome(match({ id: 'm', winnerPersonId: null }))).toMatchObject({
      result1: 'Draw',
      result2: 'Draw',
    });
  });

  it('excludes a forfeited match even when it has a winner', () => {
    expect(matchOutcome(match({ id: 'm', forfeited: true }))).toBeNull();
  });

  it('excludes a match missing a fighter on either side', () => {
    expect(matchOutcome(match({ id: 'm', redPersonId: null }))).toBeNull();
    expect(matchOutcome(match({ id: 'm', bluePersonId: null }))).toBeNull();
  });
});

// ── hemaRatingsRound ──────────────────────────────────────────────────────────

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
});

// ── tournamentFileName ────────────────────────────────────────────────────────

describe('tournamentFileName', () => {
  it('keeps the name legible — HEMA Ratings reads it out of the filename', () => {
    expect(tournamentFileName("Women's Steel Longsword")).toBe("Women's Steel Longsword");
    expect(tournamentFileName('Sword & Buckler - Mixed')).toBe('Sword & Buckler - Mixed');
    expect(tournamentFileName('Épée longue')).toBe('Épée longue');
  });

  it('strips only what a filesystem cannot carry', () => {
    expect(tournamentFileName('Mixed / Steel: Longsword?')).toBe('Mixed Steel Longsword');
    expect(tournamentFileName('Trailing dots...')).toBe('Trailing dots');
  });

  it('falls back when nothing legible survives', () => {
    expect(tournamentFileName('///')).toBe('Tournament');
    expect(tournamentFileName('   ')).toBe('Tournament');
  });
});

// ── hemaGender ────────────────────────────────────────────────────────────────

describe('hemaGender', () => {
  it('maps persons.gender_category to the HEMA M/F token (blank for mixed/unknown)', () => {
    expect(hemaGender('M')).toBe('M');
    expect(hemaGender('female')).toBe('F');
    expect(hemaGender('homme')).toBe('M');
    expect(hemaGender('femme')).toBe('F');
    expect(hemaGender('mixed')).toBe('');
    expect(hemaGender(null)).toBe('');
  });
});

// ── buildSubmission ───────────────────────────────────────────────────────────

describe('buildSubmission', () => {
  const baseInput: SubmissionInput = {
    clubs: [
      { id: 'c1', name: 'Lyon HEMA', countryCode: 'FR', city: 'Lyon', website: 'https://l.fr' },
      { id: 'c2', name: 'Örebro HEMA', countryCode: null, city: 'Örebro', website: null },
    ],
    fighters: [
      fighter({ personId: 'p1', givenName: 'Anna', familyName: 'Berg', clubId: 'c1' }),
      fighter({ personId: 'p2', givenName: 'Carl', familyName: 'Dahl', clubId: 'c2' }),
      // Registered but never fought — must not reach fighters.csv.
      fighter({ personId: 'p3', givenName: 'Eve', familyName: 'Falk', clubId: 'c1' }),
    ],
    tournaments: [
      {
        id: 't1',
        name: "Women's Steel Longsword",
        matches: [match({ id: 'm1', winnerPersonId: 'p2' })],
      },
    ],
  };

  it('names the tournament file after the tournament', () => {
    const result = buildSubmission(baseInput);
    expect(Object.keys(result.files).sort()).toEqual([
      "Women's Steel Longsword.csv",
      'clubs.csv',
      'fighters.csv',
    ]);
  });

  it('lists only fighters who actually fought', () => {
    const result = buildSubmission(baseInput);
    const names = rowsOf(result.files['fighters.csv']!).map((row) => row[0]);
    expect(names).toEqual(['Anna Berg', 'Carl Dahl']);
    expect(result.counts.fighters).toBe(2);
  });

  it('lists only the clubs of those fighters', () => {
    const result = buildSubmission(baseInput);
    const clubNames = rowsOf(result.files['clubs.csv']!).map((row) => row[0]);
    expect(clubNames).toEqual(['Lyon HEMA', 'Örebro HEMA']);
  });

  it('writes club names identically in clubs.csv and fighters.csv', () => {
    const result = buildSubmission(baseInput);
    const fromClubs = new Set(rowsOf(result.files['clubs.csv']!).map((row) => row[0]));
    for (const row of rowsOf(result.files['fighters.csv']!)) {
      expect(fromClubs.has(row[1]!)).toBe(true);
    }
  });

  it('writes fighter names identically in fighters.csv and the tournament file', () => {
    const result = buildSubmission(baseInput);
    const roster = new Set(rowsOf(result.files['fighters.csv']!).map((row) => row[0]));
    for (const row of rowsOf(result.files["Women's Steel Longsword.csv"]!)) {
      expect(roster.has(row[0]!)).toBe(true);
      expect(roster.has(row[1]!)).toBe(true);
    }
  });

  it('drops forfeited matches and counts them as excluded', () => {
    const result = buildSubmission({
      ...baseInput,
      tournaments: [
        {
          id: 't1',
          name: "Women's Steel Longsword",
          matches: [match({ id: 'm1' }), match({ id: 'm2', forfeited: true })],
        },
      ],
    });
    expect(result.counts.matches).toBe(1);
    expect(result.counts.excludedMatches).toBe(1);
    expect(result.warnings.find((w) => w.code === 'matches_excluded')?.count).toBe(1);
  });

  it('omits a tournament whose matches were all excluded, and warns', () => {
    const result = buildSubmission({
      ...baseInput,
      tournaments: [
        { id: 't1', name: 'Empty Steel Mixed', matches: [match({ id: 'm1', forfeited: true })] },
      ],
    });
    expect(Object.keys(result.files)).not.toContain('Empty Steel Mixed.csv');
    expect(result.warnings.find((w) => w.code === 'tournament_no_matches')?.samples).toEqual([
      'Empty Steel Mixed',
    ]);
  });

  it('de-duplicates tournament filenames that sanitise to the same string', () => {
    const result = buildSubmission({
      ...baseInput,
      tournaments: [
        { id: 't1', name: 'Mixed: Steel', matches: [match({ id: 'm1' })] },
        { id: 't2', name: 'Mixed / Steel', matches: [match({ id: 'm2' })] },
      ],
    });
    expect(Object.keys(result.files)).toContain('Mixed Steel.csv');
    expect(Object.keys(result.files)).toContain('Mixed Steel (2).csv');
  });

  it('escapes names containing a comma', () => {
    const result = buildSubmission({
      ...baseInput,
      fighters: [
        fighter({ personId: 'p1', givenName: 'Anna', familyName: 'Berg, Jr', clubId: 'c1' }),
        fighter({ personId: 'p2', givenName: 'Carl', familyName: 'Dahl', clubId: 'c2' }),
      ],
    });
    expect(result.files['fighters.csv']).toContain('"Anna Berg, Jr"');
    expect(result.files["Women's Steel Longsword.csv"]).toContain('"Anna Berg, Jr"');
  });

  it('warns about fighters with no HEMA Ratings ID', () => {
    const result = buildSubmission({
      ...baseInput,
      fighters: [
        fighter({ personId: 'p1', givenName: 'Anna', familyName: 'Berg', hemaRatingsId: null }),
        fighter({ personId: 'p2', givenName: 'Carl', familyName: 'Dahl' }),
      ],
    });
    const warning = result.warnings.find((w) => w.code === 'fighter_missing_hema_id');
    expect(warning).toMatchObject({ count: 1, samples: ['Anna Berg'] });
  });

  it('warns about a club with no country code', () => {
    const result = buildSubmission(baseInput);
    expect(result.warnings.find((w) => w.code === 'club_missing_country')?.samples).toEqual([
      'Örebro HEMA',
    ]);
  });

  it('warns when two competitors collide on name once accents are normalised', () => {
    const result = buildSubmission({
      ...baseInput,
      fighters: [
        fighter({ personId: 'p1', givenName: 'Jose', familyName: 'Alvarez' }),
        fighter({ personId: 'p2', givenName: 'José', familyName: 'Álvarez' }),
      ],
    });
    const warning = result.warnings.find((w) => w.code === 'duplicate_fighter_name');
    expect(warning?.count).toBe(1);
    expect(warning?.samples[0]).toContain('Jose Alvarez');
    expect(warning?.samples[0]).toContain('José Álvarez');
  });

  it('warns when a tournament name lacks gender or material', () => {
    const result = buildSubmission({
      ...baseInput,
      tournaments: [{ id: 't1', name: 'Longsword', matches: [match({ id: 'm1' })] }],
    });
    expect(result.warnings.some((w) => w.code === 'tournament_name_missing_gender')).toBe(true);
    expect(result.warnings.some((w) => w.code === 'tournament_name_missing_material')).toBe(true);
  });

  it('does not warn when gender and material are present, in French too', () => {
    const result = buildSubmission({
      ...baseInput,
      tournaments: [{ id: 't1', name: 'Épée longue acier mixte', matches: [match({ id: 'm1' })] }],
    });
    expect(result.warnings.some((w) => w.code === 'tournament_name_missing_gender')).toBe(false);
    expect(result.warnings.some((w) => w.code === 'tournament_name_missing_material')).toBe(false);
  });

  it('omits clubs.csv entirely when no competitor has a club', () => {
    const result = buildSubmission({
      ...baseInput,
      fighters: [
        fighter({ personId: 'p1', clubId: null }),
        fighter({ personId: 'p2', givenName: 'Carl', familyName: 'Dahl', clubId: null }),
      ],
    });
    expect(Object.keys(result.files)).not.toContain('clubs.csv');
  });
});
