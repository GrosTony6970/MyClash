/**
 * archive-reports.ts — the CSV reports that ride along in an organizer archive.
 *
 * Pure functions over an already-collected `ArchiveTables` snapshot: no Supabase
 * client, no service, nothing async. They were private methods on
 * `ArchiveService`, which meant the only way to exercise a round code was to
 * stand up a mocked event and read a substring out of a CSV — so the
 * double-elim round-code split had no direct test at all. Out here they are
 * called directly.
 *
 * Every value that reaches a cell goes through `escapeCsvCell`, NOT
 * `escapeCsvField`: these files are downloaded and opened in a spreadsheet, and
 * they carry organiser-written names and labels. See @myclash/types/csv for the
 * split — `escapeCsvField` is the HEMA Ratings submission escaper and has
 * different rules. Numbers are exempt on purpose.
 */
import { escapeCsvCell, formatRoundCode, roundCodeShapeFromConfig } from '@myclash/types';
import type { ArchiveRow, ArchiveTables, TournamentArchiveReports } from './archive.types';

export function buildTournamentReports(
  tournament: ArchiveRow,
  tables: ArchiveTables,
): TournamentArchiveReports {
  const tournamentId = tournament['id'] as string;
  const registrations = tables.registrations.filter((row) => row['tournament_id'] === tournamentId);
  const phaseIds = ids(tables.phases.filter((row) => row['tournament_id'] === tournamentId));
  const matches = tables.matches.filter(
    (row) => row['tournament_id'] === tournamentId || phaseIds.includes(row['phase_id'] as string),
  );
  const matchIds = ids(matches);
  const exchanges = tables.exchanges.filter((row) => matchIds.includes(row['match_id'] as string));

  // Pre-compute a matchId → roundCode map once per tournament. The pool
  // sort_order + bracket round + tournament weapon/size all come from
  // sibling tables in the same archive snapshot, so this stays consistent
  // with the data being exported even if the live DB drifts later.
  const roundCodes = computeRoundCodes(tournament, matches, tables);

  return {
    tournamentId,
    tournamentName: tournament['name'] as string,
    matchesCsv: buildMatchesCsv(matches, roundCodes),
    exchangesCsv: buildExchangesCsv(exchanges),
    resultsCsv: buildResultsReportCsv(matches, registrations, tables.persons, roundCodes),
    rankingsCsv: buildRankingsCsv(matches, registrations, tables.persons),
  };
}

/**
 * Header-only reports for a tournament that produced none.
 *
 * `tournamentName` is the id: this is the last-resort fallback for a caller that
 * asked for reports and must be handed a well-formed bundle rather than a
 * throw, and there is no name to use. Every header row is still emitted, so the
 * download opens as a valid CSV.
 */
export function emptyTournamentReports(tournamentId: string): TournamentArchiveReports {
  return {
    tournamentId,
    tournamentName: tournamentId,
    matchesCsv: buildMatchesCsv([]),
    exchangesCsv: buildExchangesCsv([]),
    resultsCsv: buildResultsReportCsv([], [], []),
    rankingsCsv: buildRankingsCsv([], [], []),
  };
}

export function safeFilename(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-|-$/g, '') || 'tournament'
  );
}

function computeRoundCodes(
  tournament: ArchiveRow,
  matches: ArchiveRow[],
  tables: ArchiveTables,
): Map<string, string> {
  const weapon = (tournament['weapon'] as string | null | undefined) ?? null;
  const poolSortOrder = new Map<string, number>();
  for (const pool of tables.pools) {
    if (typeof pool['sort_order'] === 'number') {
      poolSortOrder.set(pool['id'] as string, pool['sort_order'] as number);
    }
  }
  const slotRound = new Map<string, number>();
  for (const slot of tables.bracketSlots) {
    if (typeof slot['round'] === 'number') {
      slotRound.set(slot['id'] as string, slot['round'] as number);
    }
  }
  const swissRoundNumber = new Map<string, number>();
  for (const round of tables.swissRounds) {
    if (typeof round['round_number'] === 'number') {
      swissRoundNumber.set(round['id'] as string, round['round_number'] as number);
    }
  }
  // bracketSize lives on phases.config_json (bracketSize, or
  // mainBracketSize for double-elim); no tournaments.bracket_size
  // column exists at the SQL level. The WB/LB split comes from the same
  // blob and must travel with it — without it an archived double-elim
  // bracket exports single-elim round codes, labelling the winners final,
  // the grand final and the reset all as "F".
  const bracketSizeByPhaseId = new Map<string, number | null>();
  const roundShapeByPhaseId = new Map<string, ReturnType<typeof roundCodeShapeFromConfig>>();
  for (const phase of tables.phases) {
    const phaseType = (phase['type'] as string | null | undefined) ?? null;
    if (phaseType === 'pool') continue;
    const cfg = (phase['config_json'] as Record<string, unknown> | null | undefined) ?? null;
    const size = (cfg?.['bracketSize'] ?? cfg?.['mainBracketSize']) as number | undefined;
    bracketSizeByPhaseId.set(phase['id'] as string, typeof size === 'number' ? size : null);
    roundShapeByPhaseId.set(phase['id'] as string, roundCodeShapeFromConfig(cfg));
  }

  const out = new Map<string, string>();
  for (const match of matches) {
    const poolId = match['pool_id'] as string | null;
    const bracketSlotId = match['bracket_slot_id'] as string | null;
    const swissRoundId = match['swiss_round_id'] as string | null;
    const phaseId = match['phase_id'] as string | null;
    const poolNumber =
      poolId !== null && poolSortOrder.has(poolId)
        ? (poolSortOrder.get(poolId) as number) + 1
        : null;
    const bracketRound =
      bracketSlotId !== null && slotRound.has(bracketSlotId)
        ? (slotRound.get(bracketSlotId) as number)
        : null;
    const bracketSize = phaseId !== null ? (bracketSizeByPhaseId.get(phaseId) ?? null) : null;
    out.set(
      match['id'] as string,
      formatRoundCode({
        weapon,
        poolNumber,
        bracketRound,
        bracketSize,
        swissRound: swissRoundId !== null ? (swissRoundNumber.get(swissRoundId) ?? null) : null,
        matchNumber: (match['match_number_label'] as string | null) ?? null,
        ...(phaseId !== null ? (roundShapeByPhaseId.get(phaseId) ?? {}) : {}),
      }),
    );
  }
  return out;
}

function buildMatchesCsv(matches: ArchiveRow[], roundCodes?: Map<string, string>): string {
  const lines = [
    'match_id,round_code,match_label,status,red_registration_id,blue_registration_id,red_score,blue_score,winner_registration_id',
  ];
  for (const match of matches) {
    const code = roundCodes?.get(match['id'] as string) ?? '';
    lines.push(
      [
        match['id'],
        escapeCsvCell(code),
        escapeCsvCell(String(match['match_number_label'] ?? '')),
        match['status'] ?? '',
        match['red_registration_id'] ?? '',
        match['blue_registration_id'] ?? '',
        match['red_score'] ?? '',
        match['blue_score'] ?? '',
        match['winner_registration_id'] ?? '',
      ].join(','),
    );
  }
  return lines.join('\n');
}

function buildExchangesCsv(exchanges: ArchiveRow[]): string {
  const lines = [
    'exchange_id,match_id,sequence,type,first_striker,first_strike_value,afterblow_value,voided',
  ];
  for (const exchange of exchanges) {
    lines.push(
      [
        exchange['id'],
        exchange['match_id'],
        exchange['sequence'] ?? '',
        exchange['type'] ?? '',
        exchange['first_striker_color'] ?? '',
        exchange['first_strike_value'] ?? '',
        exchange['afterblow_value'] ?? '',
        exchange['voided'] ? 'true' : 'false',
      ].join(','),
    );
  }
  return lines.join('\n');
}

function buildResultsReportCsv(
  matches: ArchiveRow[],
  registrations: ArchiveRow[],
  persons: ArchiveRow[],
  roundCodes?: Map<string, string>,
): string {
  // Human-readable report an organiser opens in Excel, so the columns are
  // named for the SIDES, not for a colour. `red`/`blue` here held fighter
  // NAMES, and read as a lie for any tournament not run red-vs-blue. The
  // machine-readable archive CSVs keep their DB column names — those
  // round-trip on re-import.
  const lines = ['round_code,match_label,fighter_1,fighter_2,score_1,score_2,winner'];
  for (const match of matches) {
    const red = registrationName(match['red_registration_id'], registrations, persons);
    const blue = registrationName(match['blue_registration_id'], registrations, persons);
    const winner = registrationName(match['winner_registration_id'], registrations, persons);
    const code = roundCodes?.get(match['id'] as string) ?? '';
    lines.push(
      [
        escapeCsvCell(code),
        escapeCsvCell(String(match['match_number_label'] ?? '')),
        escapeCsvCell(red),
        escapeCsvCell(blue),
        match['red_score'] ?? '',
        match['blue_score'] ?? '',
        escapeCsvCell(winner),
      ].join(','),
    );
  }
  return lines.join('\n');
}

function buildRankingsCsv(
  matches: ArchiveRow[],
  registrations: ArchiveRow[],
  persons: ArchiveRow[],
): string {
  const points = new Map<string, { wins: number; pointsFor: number; pointsAgainst: number }>();
  for (const registration of registrations) {
    points.set(registration['id'] as string, { wins: 0, pointsFor: 0, pointsAgainst: 0 });
  }
  for (const match of matches.filter((row) => row['status'] === 'completed')) {
    const redId = match['red_registration_id'] as string | undefined;
    const blueId = match['blue_registration_id'] as string | undefined;
    if (!redId || !blueId) continue;
    const red = points.get(redId);
    const blue = points.get(blueId);
    if (!red || !blue) continue;
    const redScore = Number(match['red_score'] ?? 0);
    const blueScore = Number(match['blue_score'] ?? 0);
    red.pointsFor += redScore;
    red.pointsAgainst += blueScore;
    blue.pointsFor += blueScore;
    blue.pointsAgainst += redScore;
    if (match['winner_registration_id'] === redId) red.wins += 1;
    if (match['winner_registration_id'] === blueId) blue.wins += 1;
  }
  const ranked = [...registrations].sort((a, b) => {
    const left = points.get(a['id'] as string) ?? { wins: 0, pointsFor: 0, pointsAgainst: 0 };
    const right = points.get(b['id'] as string) ?? { wins: 0, pointsFor: 0, pointsAgainst: 0 };
    return (
      right.wins - left.wins ||
      right.pointsFor - left.pointsFor ||
      left.pointsAgainst - right.pointsAgainst
    );
  });
  const lines = ['rank,name,wins,points_for,points_against'];
  ranked.forEach((registration, index) => {
    const score = points.get(registration['id'] as string) ?? {
      wins: 0,
      pointsFor: 0,
      pointsAgainst: 0,
    };
    lines.push(
      [
        index + 1,
        escapeCsvCell(registrationName(registration['id'], registrations, persons)),
        score.wins,
        score.pointsFor,
        score.pointsAgainst,
      ].join(','),
    );
  });
  return lines.join('\n');
}

/**
 * The fighter's name, or the raw registration id when no person matches.
 *
 * The id fallback is deliberate and stays: this is a downloaded FILE, not a UI
 * surface, and a report that silently blanks a competitor is worse than one
 * naming a row an organiser can look up. Reached only when a registration
 * points at a person the archive does not carry.
 */
function registrationName(
  registrationId: unknown,
  registrations: ArchiveRow[],
  persons: ArchiveRow[],
): string {
  if (typeof registrationId !== 'string') return '';
  const registration = registrations.find((row) => row['id'] === registrationId);
  const person = persons.find((row) => row['id'] === registration?.['person_id']);
  if (!person) return registrationId;
  return `${person['given_name'] as string} ${person['family_name'] as string}`;
}

function ids(rows: ArchiveRow[]): string[] {
  return rows.map((row) => row['id']).filter((value): value is string => typeof value === 'string');
}
