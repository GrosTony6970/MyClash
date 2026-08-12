import { describe, expect, it } from 'vitest';
import { buildTournamentReports, emptyTournamentReports, safeFilename } from './archive-reports';
import type { ArchiveRow, ArchiveTables } from './archive.types';

/**
 * Direct coverage for the archive's CSV reports.
 *
 * These were private methods on `ArchiveService` until the extraction, so the
 * only way to reach a round code was to stand up a mocked Supabase client,
 * export a whole event and assert on a substring — which is why the entire
 * double-elimination round-code split arrived with none.
 */

/**
 * The reports read exactly these eight members of `ArchiveTables`. Defaulting
 * all 41 would claim a dependency that does not exist; this list IS the report
 * module's read surface, and a report that starts reading a ninth table should
 * have to add it here.
 */
function tables(over: Partial<ArchiveTables> = {}): ArchiveTables {
  return {
    persons: [],
    registrations: [],
    phases: [],
    pools: [],
    bracketSlots: [],
    swissRounds: [],
    matches: [],
    exchanges: [],
    ...over,
  } as ArchiveTables;
}

const TOURNAMENT: ArchiveRow = { id: 't-1', name: 'Longsword Open', weapon: 'longsword' };

/** The `round_code` column of every data row in `matchesCsv`. */
function roundCodes(csv: string): string[] {
  return csv
    .split('\n')
    .slice(1)
    .map((line) => line.split(',')[1] ?? '');
}

describe('round codes', () => {
  it('numbers a pool from its sort_order and keeps the label’s trailing match number', () => {
    const reports = buildTournamentReports(
      TOURNAMENT,
      tables({
        phases: [{ id: 'ph-1', tournament_id: 't-1', type: 'pool' }],
        pools: [{ id: 'pool-1', sort_order: 0 }],
        // The stored label is compound; only its trailing M<n> belongs in the code.
        matches: [
          { id: 'm-1', phase_id: 'ph-1', pool_id: 'pool-1', match_number_label: 'L1-PA-M3' },
        ],
      }),
    );

    expect(roundCodes(reports.matchesCsv)).toEqual(['LSW-P1-M3']);
  });

  it('labels a single-elim round by how many fighters remain', () => {
    const reports = buildTournamentReports(
      TOURNAMENT,
      tables({
        phases: [
          { id: 'ph-1', tournament_id: 't-1', type: 'bracket', config_json: { bracketSize: 8 } },
        ],
        bracketSlots: [
          { id: 'bs-1', round: 1 },
          { id: 'bs-2', round: 2 },
          { id: 'bs-3', round: 3 },
        ],
        matches: [
          { id: 'm-1', phase_id: 'ph-1', bracket_slot_id: 'bs-1', match_number_label: 1 },
          { id: 'm-2', phase_id: 'ph-1', bracket_slot_id: 'bs-2', match_number_label: 2 },
          { id: 'm-3', phase_id: 'ph-1', bracket_slot_id: 'bs-3', match_number_label: 3 },
        ],
      }),
    );

    expect(roundCodes(reports.matchesCsv)).toEqual(['LSW-B-QF-M1', 'LSW-B-SF-M2', 'LSW-B-F-M3']);
  });

  it('keeps a double-elim bracket’s three last rounds apart', () => {
    // The defect `computeRoundCodes` documents: without the WB/LB split off
    // `config_json`, an archived double-elim exports single-elim labels and the
    // winners final, the grand final and the reset stop being distinguishable.
    // `mainBracketSize` (not `bracketSize`) is the double-elim spelling.
    const reports = buildTournamentReports(
      TOURNAMENT,
      tables({
        phases: [
          {
            id: 'ph-1',
            tournament_id: 't-1',
            type: 'double_elim',
            config_json: { mainBracketSize: 8, wbRounds: 3, lbRounds: 4 },
          },
        ],
        bracketSlots: [
          { id: 'bs-wbf', round: 3 },
          { id: 'bs-lb1', round: 4 },
          { id: 'bs-gf', round: 8 },
          { id: 'bs-gfr', round: 9 },
        ],
        matches: [
          { id: 'm-1', phase_id: 'ph-1', bracket_slot_id: 'bs-wbf', match_number_label: 1 },
          { id: 'm-2', phase_id: 'ph-1', bracket_slot_id: 'bs-lb1', match_number_label: 2 },
          { id: 'm-3', phase_id: 'ph-1', bracket_slot_id: 'bs-gf', match_number_label: 3 },
          { id: 'm-4', phase_id: 'ph-1', bracket_slot_id: 'bs-gfr', match_number_label: 4 },
        ],
      }),
    );

    const codes = roundCodes(reports.matchesCsv);
    expect(codes).toEqual(['LSW-B-WBF-M1', 'LSW-B-LB1-M2', 'LSW-B-GF-M3', 'LSW-B-GFR-M4']);
    // The point of the split, stated as the property rather than the strings:
    // exactly one of these is the grand final.
    expect(new Set(codes).size).toBe(4);
    expect(codes.filter((code) => code.includes('-GF-'))).toHaveLength(1);
  });

  it('numbers a swiss match by its round', () => {
    const reports = buildTournamentReports(
      TOURNAMENT,
      tables({
        phases: [{ id: 'ph-1', tournament_id: 't-1', type: 'swiss' }],
        swissRounds: [{ id: 'sr-1', round_number: 3 }],
        matches: [{ id: 'm-1', phase_id: 'ph-1', swiss_round_id: 'sr-1', match_number_label: 2 }],
      }),
    );

    expect(roundCodes(reports.matchesCsv)).toEqual(['LSW-S3-M2']);
  });

  it('falls back to the first three letters of an unknown weapon', () => {
    const reports = buildTournamentReports(
      { ...TOURNAMENT, weapon: 'Dussack' },
      tables({
        phases: [{ id: 'ph-1', tournament_id: 't-1', type: 'pool' }],
        pools: [{ id: 'pool-1', sort_order: 1 }],
        matches: [{ id: 'm-1', phase_id: 'ph-1', pool_id: 'pool-1', match_number_label: 1 }],
      }),
    );

    expect(roundCodes(reports.matchesCsv)).toEqual(['DUS-P2-M1']);
  });
});

describe('spreadsheet safety', () => {
  const withFighters = (given: string, family: string) =>
    buildTournamentReports(
      TOURNAMENT,
      tables({
        persons: [{ id: 'p-1', given_name: given, family_name: family }],
        registrations: [{ id: 'r-1', tournament_id: 't-1', person_id: 'p-1' }],
        phases: [{ id: 'ph-1', tournament_id: 't-1', type: 'pool' }],
        matches: [
          {
            id: 'm-1',
            phase_id: 'ph-1',
            status: 'completed',
            red_registration_id: 'r-1',
            match_number_label: 1,
          },
        ],
      }),
    );

  it('neutralises a name a spreadsheet would evaluate as a formula', () => {
    // An organiser opens this file. The name is written by someone else.
    const reports = withFighters('=cmd|’ /C calc’!A0', 'Attacker');

    expect(reports.resultsCsv).toContain(`"'=cmd|’ /C calc’!A0 Attacker"`);
    expect(reports.rankingsCsv).toContain(`"'=cmd|’ /C calc’!A0 Attacker"`);
    // Never the bare form — an unquoted apostrophe is dropped by Excel and the
    // formula fires anyway.
    expect(reports.resultsCsv).not.toContain(`'=cmd|’ /C calc’!A0 Attacker,`);
  });

  it.each(['+1-800-SCAM', '-2+3', '@SUM(A1)'])('neutralises a leading %s', (given) => {
    expect(withFighters(given, 'Fighter').resultsCsv).toContain(`"'${given} Fighter"`);
  });

  it('quotes a name carrying a comma or a quote instead of breaking the row', () => {
    const reports = withFighters('Bob', 'Club, "Jr."');

    expect(reports.resultsCsv).toContain('"Bob Club, ""Jr."""');
    // One header + one data row: the comma did not split the row.
    expect(reports.resultsCsv.split('\n')).toHaveLength(2);
  });

  it('leaves a plain negative number alone so the column still sums', () => {
    // FORMULA_LEAD matches `-`, PLAIN_NUMBER exempts it. Reached here through a
    // label rather than a name, since that is where a bare number lands.
    const reports = buildTournamentReports(
      TOURNAMENT,
      tables({
        phases: [{ id: 'ph-1', tournament_id: 't-1', type: 'pool' }],
        matches: [{ id: 'm-1', phase_id: 'ph-1', match_number_label: '-3' }],
      }),
    );

    expect(reports.matchesCsv).toContain(',-3,');
  });
});

describe('rankings', () => {
  it('orders by wins, then points for, then points against ascending', () => {
    const reports = buildTournamentReports(
      TOURNAMENT,
      tables({
        persons: [
          { id: 'p-1', given_name: 'Ada', family_name: 'One' },
          { id: 'p-2', given_name: 'Bo', family_name: 'Two' },
          { id: 'p-3', given_name: 'Cy', family_name: 'Three' },
          { id: 'p-4', given_name: 'Di', family_name: 'Four' },
        ],
        registrations: [
          { id: 'r-1', tournament_id: 't-1', person_id: 'p-1' },
          { id: 'r-2', tournament_id: 't-1', person_id: 'p-2' },
          { id: 'r-3', tournament_id: 't-1', person_id: 'p-3' },
          { id: 'r-4', tournament_id: 't-1', person_id: 'p-4' },
        ],
        phases: [{ id: 'ph-1', tournament_id: 't-1', type: 'pool' }],
        matches: [
          {
            id: 'm-1',
            phase_id: 'ph-1',
            status: 'completed',
            red_registration_id: 'r-1',
            blue_registration_id: 'r-2',
            red_score: 5,
            blue_score: 3,
            winner_registration_id: 'r-1',
          },
          {
            id: 'm-2',
            phase_id: 'ph-1',
            status: 'completed',
            red_registration_id: 'r-3',
            blue_registration_id: 'r-4',
            red_score: 5,
            blue_score: 1,
            winner_registration_id: 'r-3',
          },
        ],
      }),
    );

    // r-3 and r-1 both won with 5 points for; r-3 conceded 1 against r-1's 3.
    // r-2 and r-4 both lost; r-2 scored 3 to r-4's 1.
    expect(reports.rankingsCsv.split('\n').slice(1)).toEqual([
      '1,Cy Three,1,5,1',
      '2,Ada One,1,5,3',
      '3,Bo Two,0,3,5',
      '4,Di Four,0,1,5',
    ]);
  });

  it('ignores a match that is not completed', () => {
    const reports = buildTournamentReports(
      TOURNAMENT,
      tables({
        persons: [{ id: 'p-1', given_name: 'Ada', family_name: 'One' }],
        registrations: [{ id: 'r-1', tournament_id: 't-1', person_id: 'p-1' }],
        phases: [{ id: 'ph-1', tournament_id: 't-1', type: 'pool' }],
        matches: [
          {
            id: 'm-1',
            phase_id: 'ph-1',
            status: 'in_progress',
            red_registration_id: 'r-1',
            blue_registration_id: 'r-2',
            red_score: 5,
            winner_registration_id: 'r-1',
          },
        ],
      }),
    );

    expect(reports.rankingsCsv.split('\n').slice(1)).toEqual(['1,Ada One,0,0,0']);
  });
});

describe('names', () => {
  it('falls back to the registration id when the archive has no person for it', () => {
    // Deliberate, and pinned so nobody "fixes" it into a blank cell: this is a
    // downloaded file, not a UI surface, and a report that silently drops a
    // competitor is worse than one naming a row an organiser can look up.
    const reports = buildTournamentReports(
      TOURNAMENT,
      tables({
        persons: [],
        registrations: [{ id: 'r-1', tournament_id: 't-1', person_id: 'p-gone' }],
        phases: [{ id: 'ph-1', tournament_id: 't-1', type: 'pool' }],
        matches: [
          {
            id: 'm-1',
            phase_id: 'ph-1',
            red_registration_id: 'r-1',
            match_number_label: 1,
          },
        ],
      }),
    );

    expect(reports.resultsCsv).toContain('r-1');
  });

  it('leaves an absent side as an empty cell', () => {
    const reports = buildTournamentReports(
      TOURNAMENT,
      tables({
        phases: [{ id: 'ph-1', tournament_id: 't-1', type: 'pool' }],
        matches: [{ id: 'm-1', phase_id: 'ph-1', match_number_label: 1 }],
      }),
    );

    // round_code,match_label,fighter_1,fighter_2,score_1,score_2,winner
    // match_label is the stored label as-is; the `M` prefix belongs to the code.
    expect(reports.resultsCsv.split('\n')[1]).toBe('LSW-M1,1,,,,,');
  });
});

describe('scoping', () => {
  it('takes matches from the tournament’s own phases and nothing else', () => {
    const reports = buildTournamentReports(
      TOURNAMENT,
      tables({
        phases: [
          { id: 'ph-1', tournament_id: 't-1', type: 'pool' },
          { id: 'ph-2', tournament_id: 't-2', type: 'pool' },
        ],
        matches: [
          { id: 'mine', phase_id: 'ph-1', match_number_label: 1 },
          { id: 'theirs', phase_id: 'ph-2', match_number_label: 1 },
        ],
        exchanges: [
          { id: 'ex-1', match_id: 'mine', sequence: 1 },
          { id: 'ex-2', match_id: 'theirs', sequence: 1 },
        ],
      }),
    );

    expect(reports.matchesCsv).toContain('mine');
    expect(reports.matchesCsv).not.toContain('theirs');
    // Exchanges follow the matches, so the other tournament's drop out too.
    expect(reports.exchangesCsv).toContain('ex-1');
    expect(reports.exchangesCsv).not.toContain('ex-2');
  });
});

describe('empty reports', () => {
  it('still emits every header row', () => {
    const reports = emptyTournamentReports('t-1');

    expect(reports.matchesCsv.split('\n')).toHaveLength(1);
    expect(reports.matchesCsv).toContain('match_id,round_code');
    expect(reports.exchangesCsv).toContain('exchange_id,match_id');
    expect(reports.resultsCsv).toContain('round_code,match_label');
    expect(reports.rankingsCsv).toContain('rank,name');
    // No name to use — the id is the documented last resort.
    expect(reports.tournamentName).toBe('t-1');
  });
});

describe('safeFilename', () => {
  it.each([
    ['Longsword Open', 'longsword-open'],
    ['Épée & Buckler', 'p-e-buckler'],
    // The fallback fires only on a value that strips to nothing at all. A name
    // made of separators keeps them — `reports/---/matches.csv` is ugly and
    // harmless, and pinned here so it reads as known rather than as a surprise.
    ['  ---  ', '---'],
    ['', 'tournament'],
    ['???', 'tournament'],
  ])('turns %j into %j', (input, expected) => {
    expect(safeFilename(input)).toBe(expected);
  });
});
