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
 * The builders return ROWS, header first; the file is written by its caller. Every cell is
 * formula-safe (`csvRow` → `escapeCsvCell`'s rules, NOT `escapeCsvField`'s): these files are
 * opened in a spreadsheet and carry organiser-written names and labels. Numbers are exempt on
 * purpose. The archive keeps its copies as they always were: the standard format, `\n` between
 * rows, no byte-order mark. A Tournament's single download (`csvDownload`) writes the file the
 * organiser picked (operator, 2026-10-15).
 */
import { CSV_STANDARD, csvRow, formatRoundCode, roundCodeShapeFromConfig } from '@myclash/types';
import { unknownFighterInEnglish } from '../../common/unknown-name';
import type { ArchiveRow, ArchiveTables, TournamentArchiveReports } from './archive.types';

/** One CSV report: its header, then a row per line. */
export type ReportRows = unknown[][];

/** The four reports of one Tournament. */
export interface TournamentReportRows {
  matches: ReportRows;
  exchanges: ReportRows;
  results: ReportRows;
  rankings: ReportRows;
}

/** The reports as the archive carries them: byte for byte what an archive always held. */
export function buildTournamentReports(
  tournament: ArchiveRow,
  tables: ArchiveTables,
): TournamentArchiveReports {
  const rows = buildTournamentReportRows(tournament, tables);
  return {
    tournamentId: tournament['id'] as string,
    tournamentName: tournament['name'] as string,
    matchesCsv: archiveCsvText(rows.matches),
    exchangesCsv: archiveCsvText(rows.exchanges),
    resultsCsv: archiveCsvText(rows.results),
    rankingsCsv: archiveCsvText(rows.rankings),
  };
}

function archiveCsvText(rows: ReportRows): string {
  return rows.map((row) => csvRow(row, CSV_STANDARD)).join('\n');
}

export function buildTournamentReportRows(
  tournament: ArchiveRow,
  tables: ArchiveTables,
): TournamentReportRows {
  const tournamentId = tournament['id'] as string;
  const registrations = tables.registrations.filter((row) => row['tournament_id'] === tournamentId);
  const phaseIds = ids(tables.phases.filter((row) => row['tournament_id'] === tournamentId));
  const matches = inBoutOrder(
    tables.matches.filter(
      (row) =>
        row['tournament_id'] === tournamentId || phaseIds.includes(row['phase_id'] as string),
    ),
    tables.phases,
  );
  const matchIds = ids(matches);
  const exchanges = inHitOrder(
    tables.exchanges.filter((row) => matchIds.includes(row['match_id'] as string)),
    matchIds,
  );

  // Pre-compute a matchId → roundCode map once per tournament. The pool
  // sort_order + bracket round + tournament weapon/size all come from
  // sibling tables in the same archive snapshot, so this stays consistent
  // with the data being exported even if the live DB drifts later.
  const roundCodes = computeRoundCodes(tournament, matches, tables);

  return {
    matches: matchesRows(matches, roundCodes),
    exchanges: exchangesRows(exchanges),
    results: resultsRows(matches, registrations, tables.persons, roundCodes),
    rankings: rankingsRows(matches, registrations, tables.persons),
  };
}

/**
 * The reports' order is made HERE, whatever order the tables were read in (by key, a random
 * uuid): bouts by phase, then by label as a person counts ("M2" before "M10"), then id; a bout's
 * hits after its bout, by sequence. An organiser reads each bout's hits together.
 */
function inBoutOrder(matches: ArchiveRow[], phases: ArchiveRow[]): ArchiveRow[] {
  const phaseOrder = new Map(
    phases.map((phase) => [phase['id'], Number(phase['sort_order'] ?? 0)]),
  );
  const label = (match: ArchiveRow) => String(match['match_number_label'] ?? '');
  return [...matches].sort(
    (a, b) =>
      (phaseOrder.get(a['phase_id']) ?? 0) - (phaseOrder.get(b['phase_id']) ?? 0) ||
      label(a).localeCompare(label(b), undefined, { numeric: true }) ||
      String(a['id']).localeCompare(String(b['id'])),
  );
}

function inHitOrder(exchanges: ArchiveRow[], matchIds: string[]): ArchiveRow[] {
  const boutOrder = new Map(matchIds.map((id, index) => [id, index]));
  return [...exchanges].sort(
    (a, b) =>
      (boutOrder.get(a['match_id'] as string) ?? 0) -
        (boutOrder.get(b['match_id'] as string) ?? 0) ||
      Number(a['sequence'] ?? 0) - Number(b['sequence'] ?? 0) ||
      String(a['id']).localeCompare(String(b['id'])),
  );
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

function matchesRows(matches: ArchiveRow[], roundCodes: Map<string, string>): ReportRows {
  return [
    [
      'match_id',
      'round_code',
      'match_label',
      'status',
      'red_registration_id',
      'blue_registration_id',
      'red_score',
      'blue_score',
      'winner_registration_id',
      'end_reason',
    ],
    ...matches.map((match) => [
      match['id'],
      roundCodes.get(match['id'] as string) ?? '',
      String(match['match_number_label'] ?? ''),
      match['status'],
      match['red_registration_id'],
      match['blue_registration_id'],
      match['red_score'],
      match['blue_score'],
      match['winner_registration_id'],
      // Without it a 0-0 double loss is indistinguishable in the archive from
      // a genuine draw, and the fact is gone for good once the event is.
      match['end_reason'],
    ]),
  ];
}

function exchangesRows(exchanges: ArchiveRow[]): ReportRows {
  return [
    [
      'exchange_id',
      'match_id',
      'sequence',
      'type',
      'first_striker',
      'first_strike_value',
      'afterblow_value',
      'voided',
    ],
    ...exchanges.map((exchange) => [
      exchange['id'],
      exchange['match_id'],
      exchange['sequence'],
      exchange['type'],
      exchange['first_striker_color'],
      exchange['first_strike_value'],
      exchange['afterblow_value'],
      exchange['voided'] ? 'true' : 'false',
    ]),
  ];
}

function resultsRows(
  matches: ArchiveRow[],
  registrations: ArchiveRow[],
  persons: ArchiveRow[],
  roundCodes: Map<string, string>,
): ReportRows {
  // Human-readable report an organiser opens in Excel, so the columns are
  // named for the SIDES, not for a colour. `red`/`blue` here held fighter
  // NAMES, and read as a lie for any tournament not run red-vs-blue. The
  // machine-readable archive CSVs keep their DB column names — those
  // round-trip on re-import.
  return [
    [
      'round_code',
      'match_label',
      'fighter_1',
      'fighter_2',
      'score_1',
      'score_2',
      'winner',
      'end_reason',
    ],
    ...matches.map((match) => [
      roundCodes.get(match['id'] as string) ?? '',
      String(match['match_number_label'] ?? ''),
      registrationName(match['red_registration_id'], registrations, persons),
      registrationName(match['blue_registration_id'], registrations, persons),
      match['red_score'],
      match['blue_score'],
      registrationName(match['winner_registration_id'], registrations, persons),
      // The winner cell is empty for every bout the engine gave no winner —
      // a time-out, a genuine draw and a double loss all read the same
      // without this. The organiser opens this one in Excel.
      String(match['end_reason'] ?? ''),
    ]),
  ];
}

const NO_SCORE = Object.freeze({ wins: 0, pointsFor: 0, pointsAgainst: 0 });

function rankingsRows(
  matches: ArchiveRow[],
  registrations: ArchiveRow[],
  persons: ArchiveRow[],
): ReportRows {
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
    const left = points.get(a['id'] as string) ?? NO_SCORE;
    const right = points.get(b['id'] as string) ?? NO_SCORE;
    return (
      right.wins - left.wins ||
      right.pointsFor - left.pointsFor ||
      left.pointsAgainst - right.pointsAgainst
    );
  });
  return [
    ['rank', 'name', 'wins', 'points_for', 'points_against'],
    ...ranked.map((registration, index) => {
      const score = points.get(registration['id'] as string) ?? NO_SCORE;
      return [
        index + 1,
        registrationName(registration['id'], registrations, persons),
        score.wins,
        score.pointsFor,
        score.pointsAgainst,
      ];
    }),
  ];
}

/**
 * The fighter's name, or "Unknown fighter (bib 12)" when the archive holds no name for them:
 * never the registration id (operator ruling, X2, 2026-10-15). The machine-readable CSVs of the
 * same archive keep the ids, so a row can still be looked up there.
 */
function registrationName(
  registrationId: unknown,
  registrations: ArchiveRow[],
  persons: ArchiveRow[],
): string {
  if (typeof registrationId !== 'string') return '';
  const registration = registrations.find((row) => row['id'] === registrationId);
  const person = persons.find((row) => row['id'] === registration?.['person_id']);
  const name = `${(person?.['given_name'] as string | null) ?? ''} ${(person?.['family_name'] as string | null) ?? ''}`;
  if (name.trim()) return name.trim();
  const bib = registration?.['bib_number'];
  return unknownFighterInEnglish(typeof bib === 'number' ? bib : null);
}

function ids(rows: ArchiveRow[]): string[] {
  return rows.map((row) => row['id']).filter((value): value is string => typeof value === 'string');
}
