/**
 * HEMA Ratings submission bundle — the pure core.
 *
 * hemaratings.com accepts a multi-file CSV upload:
 *   fighters.csv            (required)
 *   [tournament name].csv   (required, one per tournament)
 *   clubs.csv               (optional — skipping it means filling clubs in by
 *                            hand later in their submission flow, so we ship it)
 *
 * Column shapes and the results vocabulary come from their official
 * `Template.xlsx` + `Explanation.docx`. Rules from that document that are
 * encoded here, because getting them wrong silently corrupts a fighter's
 * rating upstream:
 *
 *   - A double loss is a LOSS FOR BOTH fighters, not a draw.
 *   - Walk-overs and fights that did not happen must NOT be included.
 *   - Fighter names must be byte-identical between fighters.csv and every
 *     tournament file; club names likewise between clubs.csv and fighters.csv.
 *     Both hold here because every name is written from one resolved source.
 *
 * No I/O — everything arrives pre-resolved from ExportsService so this stays
 * directly testable.
 */

import {
  CSV_HEADERS,
  hemaGender,
  hemaRatingsRound,
  matchOutcome,
  toCsv,
  tournamentFileName,
} from './hema-ratings-format';

// ── Input shapes ──────────────────────────────────────────────────────────────

export interface SubmissionClub {
  id: string;
  name: string;
  countryCode: string | null;
  city: string | null;
  website: string | null;
}

export interface SubmissionFighter {
  personId: string;
  givenName: string;
  familyName: string;
  clubId: string | null;
  /** global_persons.country_code, falling back to the club's country. */
  nationality: string | null;
  genderCategory: string | null;
  hemaRatingsId: string | null;
}

export interface SubmissionMatch {
  id: string;
  redPersonId: string | null;
  bluePersonId: string | null;
  winnerPersonId: string | null;
  /** matches.end_reason — 'max_doubles' means both fighters lost. */
  endReason: string | null;
  /** True when an un-voided match_forfeits row covers this match. */
  forfeited: boolean;
  phaseType: string;
  /** phases.config_json — carries wbRounds/lbRounds for double elimination. */
  phaseConfig: Record<string, unknown> | null;
  poolSortOrder: number | null;
  bracketRound: number | null;
  /**
   * `swiss_rounds.round_number`. Required rather than optional: this shape has
   * exactly two producers (`toSubmissionMatch` and the test fixture), so making
   * it mandatory means the round column cannot silently go missing when the
   * column is wired up.
   */
  swissRound: number | null;
  matchLabel: string | null;
}

export interface SubmissionTournament {
  id: string;
  name: string;
  matches: SubmissionMatch[];
}

export interface SubmissionInput {
  clubs: SubmissionClub[];
  fighters: SubmissionFighter[];
  tournaments: SubmissionTournament[];
}

// ── Output shapes ─────────────────────────────────────────────────────────────

export type SubmissionWarningCode =
  | 'fighter_missing_hema_id'
  | 'fighter_missing_nationality'
  | 'club_missing_country'
  | 'duplicate_fighter_name'
  | 'tournament_name_missing_gender'
  | 'tournament_name_missing_material'
  | 'tournament_no_matches'
  | 'matches_excluded';

export interface SubmissionWarning {
  code: SubmissionWarningCode;
  /** Total affected rows — `samples` may be shorter. */
  count: number;
  samples: string[];
}

export interface SubmissionResult {
  /** Zip entry name → CSV body. */
  files: Record<string, string>;
  counts: {
    clubs: number;
    fighters: number;
    tournaments: number;
    matches: number;
    excludedMatches: number;
  };
  warnings: SubmissionWarning[];
}

const MAX_WARNING_SAMPLES = 25;

// ── Builder ───────────────────────────────────────────────────────────────────

export function buildSubmission(input: SubmissionInput): SubmissionResult {
  const fightersByPersonId = new Map(input.fighters.map((f) => [f.personId, f]));
  const tournamentFiles = buildTournamentFiles(input.tournaments, fightersByPersonId);

  // Only fighters who appear in an exported match are competitors: that drops
  // referees, workshop-only attendees and no-shows without a separate filter.
  const competitors = input.fighters
    .filter((f) => tournamentFiles.competedPersonIds.has(f.personId))
    .sort(
      (a, b) => a.familyName.localeCompare(b.familyName) || a.givenName.localeCompare(b.givenName),
    );
  const clubs = clubsOf(competitors, input.clubs);

  const files: Record<string, string> = {
    ...tournamentFiles.files,
    'fighters.csv': buildFightersCsv(competitors, clubs),
  };
  if (clubs.length > 0) files['clubs.csv'] = buildClubsCsv(clubs);

  return {
    files,
    counts: {
      clubs: clubs.length,
      fighters: competitors.length,
      tournaments: Object.keys(tournamentFiles.files).length,
      matches: tournamentFiles.matches,
      excludedMatches: tournamentFiles.excluded,
    },
    warnings: collectWarnings(input, competitors, clubs, tournamentFiles),
  };
}

interface TournamentFiles {
  files: Record<string, string>;
  competedPersonIds: Set<string>;
  emptyTournaments: string[];
  matches: number;
  excluded: number;
}

function buildTournamentFiles(
  tournaments: readonly SubmissionTournament[],
  fightersByPersonId: Map<string, SubmissionFighter>,
): TournamentFiles {
  const files: Record<string, string> = {};
  const competedPersonIds = new Set<string>();
  const usedFileNames = new Set<string>();
  const emptyTournaments: string[] = [];
  let matches = 0;
  let excluded = 0;

  for (const tournament of tournaments) {
    const rows: string[][] = [];
    for (const match of tournament.matches) {
      const outcome = matchOutcome(match);
      const name1 = outcome && fighterName(fightersByPersonId.get(outcome.fighter1PersonId));
      const name2 = outcome && fighterName(fightersByPersonId.get(outcome.fighter2PersonId));
      // A match whose fighter is missing from the roster would write a blank
      // name that HEMA Ratings cannot match to anyone — drop it instead.
      if (!outcome || !name1 || !name2) {
        excluded += 1;
        continue;
      }
      competedPersonIds.add(outcome.fighter1PersonId);
      competedPersonIds.add(outcome.fighter2PersonId);
      rows.push([name1, name2, outcome.result1, outcome.result2, hemaRatingsRound(match)]);
    }

    matches += rows.length;
    if (rows.length === 0) {
      emptyTournaments.push(tournament.name);
      continue;
    }
    files[uniqueFileName(tournament.name, usedFileNames)] = toCsv(CSV_HEADERS.matches, rows);
  }

  return { files, competedPersonIds, emptyTournaments, matches, excluded };
}

function clubsOf(
  competitors: readonly SubmissionFighter[],
  allClubs: readonly SubmissionClub[],
): SubmissionClub[] {
  const clubIds = new Set(
    competitors.map((f) => f.clubId).filter((id): id is string => id !== null),
  );
  return allClubs.filter((c) => clubIds.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
}

function buildFightersCsv(
  competitors: readonly SubmissionFighter[],
  clubs: readonly SubmissionClub[],
): string {
  const clubNameById = new Map(clubs.map((c) => [c.id, c.name]));
  return toCsv(
    CSV_HEADERS.fighters,
    competitors.map((f) => [
      fighterName(f),
      f.clubId ? (clubNameById.get(f.clubId) ?? '') : '',
      f.nationality ?? '',
      hemaGender(f.genderCategory),
      f.hemaRatingsId ?? '',
    ]),
  );
}

function buildClubsCsv(clubs: readonly SubmissionClub[]): string {
  return toCsv(
    CSV_HEADERS.clubs,
    // State, Facebook and Parent club have no column in our schema; the spec
    // treats them as optional, so they stay blank rather than guessed.
    clubs.map((c) => [c.name, c.countryCode ?? '', '', c.city ?? '', c.website ?? '', '', '']),
  );
}

function collectWarnings(
  input: SubmissionInput,
  competitors: readonly SubmissionFighter[],
  clubs: readonly SubmissionClub[],
  tournamentFiles: TournamentFiles,
): SubmissionWarning[] {
  const warnings: SubmissionWarning[] = [];
  const push = (code: SubmissionWarningCode, affected: string[]) =>
    pushWarning(warnings, code, affected);

  push('fighter_missing_hema_id', competitors.filter((f) => !f.hemaRatingsId).map(fighterName));
  push('fighter_missing_nationality', competitors.filter((f) => !f.nationality).map(fighterName));
  push(
    'club_missing_country',
    clubs.filter((c) => !c.countryCode).map((c) => c.name),
  );
  push('duplicate_fighter_name', duplicateNames(competitors));
  push(
    'tournament_name_missing_gender',
    input.tournaments.filter((t) => !hasWord(t.name, GENDER_WORDS)).map((t) => t.name),
  );
  push(
    'tournament_name_missing_material',
    input.tournaments.filter((t) => !hasWord(t.name, MATERIAL_WORDS)).map((t) => t.name),
  );
  push('tournament_no_matches', tournamentFiles.emptyTournaments);
  if (tournamentFiles.excluded > 0) {
    warnings.push({ code: 'matches_excluded', count: tournamentFiles.excluded, samples: [] });
  }
  return warnings;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fighterName(fighter: SubmissionFighter | undefined): string {
  if (!fighter) return '';
  return `${fighter.givenName} ${fighter.familyName}`.trim();
}

function uniqueFileName(tournamentName: string, used: Set<string>): string {
  const base = tournamentFileName(tournamentName);
  let candidate = `${base}.csv`;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base} (${suffix}).csv`;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function pushWarning(
  warnings: SubmissionWarning[],
  code: SubmissionWarningCode,
  affected: string[],
): void {
  if (affected.length === 0) return;
  warnings.push({
    code,
    count: affected.length,
    samples: affected.slice(0, MAX_WARNING_SAMPLES),
  });
}

/**
 * HEMA Ratings matches fighters by name string, so two competitors whose names
 * collide once accents and case are normalised will silently merge into one
 * upstream record. Report every spelling in a colliding group.
 */
function duplicateNames(fighters: readonly SubmissionFighter[]): string[] {
  const groups = new Map<string, string[]>();
  for (const fighter of fighters) {
    const name = fighterName(fighter);
    const key = normalizeName(name);
    const group = groups.get(key);
    if (group) group.push(name);
    else groups.set(key, [name]);
  }
  return [...groups.values()].filter((group) => group.length > 1).map((group) => group.join(' / '));
}

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// The spec asks for gender AND material in the tournament name ("Mixed Nylon
// Longsword"). We cannot synthesise either — tournaments.category was dropped
// in migration 0049 and there is no material column — so we detect their
// absence and let the organiser rename. French spellings included: the name is
// whatever the organiser typed.
const GENDER_WORDS = [
  'men',
  'mens',
  "men's",
  'women',
  'womens',
  "women's",
  'mixed',
  'open',
  'ladies',
  'hommes',
  'femmes',
  'mixte',
  'dames',
];

const MATERIAL_WORDS = [
  'steel',
  'nylon',
  'wood',
  'wooden',
  'synthetic',
  'plastic',
  'feder',
  'blunt',
  'acier',
  'bois',
  'synthetique',
  'synthétique',
];

function hasWord(name: string, words: string[]): boolean {
  const tokens = new Set(
    normalizeName(name)
      .split(/[^a-z0-9']+/)
      .filter(Boolean),
  );
  return words.some((word) => tokens.has(normalizeName(word)));
}
