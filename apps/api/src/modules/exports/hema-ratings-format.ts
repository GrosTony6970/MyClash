/**
 * HEMA Ratings CSV format rules.
 *
 * Everything here answers "what will hemaratings.com accept?" — column headers,
 * the results vocabulary, round names, filename legality. Split out of
 * hema-ratings-submission.ts so the assembly logic (which rows go in which
 * file) stays separate from the format those rows must take.
 *
 * Rules encoded here come from HEMA Ratings' own Template.xlsx +
 * Explanation.docx. Getting them wrong silently corrupts a fighter's rating
 * upstream, so each one carries the reason it exists.
 */

import type { SubmissionMatch } from './hema-ratings-submission';

export type HemaResult = 'Win' | 'Loss' | 'Draw' | 'NoData';

export interface MatchOutcome {
  /** Winner first, per the template's convention. */
  fighter1PersonId: string;
  fighter2PersonId: string;
  result1: HemaResult;
  result2: HemaResult;
}

// ── Header rows ───────────────────────────────────────────────────────────────

/**
 * Verbatim from Template.xlsx. HEMA Ratings describes each CSV as "equivalent
 * to the [X] sheet in the XLSX template", so the template's own header text is
 * the most faithful reading — and gives their parser the best chance if it
 * matches on column names rather than position.
 *
 * If an upload is ever rejected for carrying headers, flip HEADER_ROW to false;
 * nothing else needs to change.
 */
export const HEADER_ROW = true;

export const CSV_HEADERS = {
  clubs: [
    'Club Name (Full name, spelled correctly)',
    'Country (two-letter country code)',
    'State (if applicable)',
    'City',
    'Website URL',
    'Facebook URL',
    'Parent club (see explanation document)',
  ],
  fighters: [
    'Name («Firstname Lastname» format)',
    'Club',
    'Nationality (two-letter country code)',
    'Gender (kept for backward compatibility)',
    'HEMA Ratings ID (see explanation document)',
  ],
  matches: [
    'Fighter 1 (Written exactly as in the Fighters sheet)',
    'Fighter 2 (Written exactly as in the Fighters sheet)',
    'Fighter 1 result',
    'Fighter 2 result',
    'Round (if available)',
  ],
} as const;

// ── Result mapping ────────────────────────────────────────────────────────────

/**
 * Resolve one match into the two result cells, or null when the match must not
 * be submitted at all.
 *
 * Order matters: a forfeited match is dropped before any score is consulted,
 * and the double-loss check runs before the winner check because a max-doubles
 * match has no winner and would otherwise read as a draw.
 */
export function matchOutcome(
  match: Pick<
    SubmissionMatch,
    'redPersonId' | 'bluePersonId' | 'winnerPersonId' | 'endReason' | 'forfeited'
  >,
): MatchOutcome | null {
  const red = match.redPersonId;
  const blue = match.bluePersonId;
  // A side with no fighter is not a fight that happened.
  if (!red || !blue) return null;
  // "Don't include walk-overs or fights that didn't happen."
  if (match.forfeited) return null;

  if (match.endReason === 'max_doubles') {
    return { fighter1PersonId: red, fighter2PersonId: blue, result1: 'Loss', result2: 'Loss' };
  }
  if (match.winnerPersonId === red) {
    return { fighter1PersonId: red, fighter2PersonId: blue, result1: 'Win', result2: 'Loss' };
  }
  if (match.winnerPersonId === blue) {
    return { fighter1PersonId: blue, fighter2PersonId: red, result1: 'Win', result2: 'Loss' };
  }
  return { fighter1PersonId: red, fighter2PersonId: blue, result1: 'Draw', result2: 'Draw' };
}

// ── Round naming ──────────────────────────────────────────────────────────────

/**
 * Round label in HEMA Ratings' own vocabulary ("Final", "Semi Final",
 * "Bronze Final", "Pool 1"), which differs from the short operator-facing
 * codes `formatRoundCode` emits ("LSW-B-WBF-M1"). Kept separate rather than
 * parameterised so neither namer can drift into the other's output.
 */
export function hemaRatingsRound(
  match: Pick<
    SubmissionMatch,
    'phaseType' | 'phaseConfig' | 'poolSortOrder' | 'bracketRound' | 'matchLabel'
  >,
): string {
  if (match.phaseType === 'pool') {
    return match.poolSortOrder === null ? 'Pools' : `Pool ${match.poolSortOrder + 1}`;
  }
  if (match.phaseType === 'double_elim') return doubleElimRound(match);
  if (match.phaseType === 'single_elim') return singleElimRound(match.matchLabel);
  return match.matchLabel ?? 'Elimination';
}

function singleElimRound(matchLabel: string | null): string {
  const label = (matchLabel ?? '').toUpperCase();
  // Bronze first: a bronze label often contains "FINAL" too.
  if (label.includes('BRONZE') || label.includes('3RD')) return 'Bronze Final';
  if (label.includes('FINAL') || label === 'F') return 'Final';
  if (label.includes('SF') || label.includes('SEMI')) return 'Semi Final';
  if (label.includes('QF') || label.includes('QUARTER')) return 'Quarter Final';
  if (label.includes('R16') || label.includes('TOP16') || label.includes('TOP 16'))
    return 'Round of 16';
  if (label.includes('R32') || label.includes('TOP32') || label.includes('TOP 32'))
    return 'Round of 32';
  if (label.includes('R64') || label.includes('TOP64') || label.includes('TOP 64'))
    return 'Round of 64';
  return matchLabel ?? 'Elimination';
}

/** Winners-bracket depth label, given how many fighters remain at that round. */
function winnersRound(round: number, wbRounds: number): string {
  const left = 2 ** (wbRounds - round + 1);
  if (left === 2) return 'Winners Final';
  if (left === 4) return 'Winners Semi Final';
  if (left === 8) return 'Winners Quarter Final';
  return `Winners Round of ${left}`;
}

function doubleElimRound(
  match: Pick<SubmissionMatch, 'phaseConfig' | 'bracketRound' | 'matchLabel'>,
): string {
  const config = match.phaseConfig ?? {};
  const wbRounds = typeof config['wbRounds'] === 'number' ? config['wbRounds'] : null;
  const lbRounds = typeof config['lbRounds'] === 'number' ? config['lbRounds'] : null;
  const round = match.bracketRound;
  if (round === null || wbRounds === null || lbRounds === null) {
    return match.matchLabel ?? 'Elimination';
  }
  if (round === 0) return 'Play-ins';

  // Bronze mode has no grand final: the WINNERS-bracket final decides the
  // title, and the repechage's last round is the bronze match. Naming those
  // "Winners Final" and "Losers Round 3" would understate both to a rating
  // system that reads the stage name.
  if (config['secondChanceTarget'] === 'bronze') {
    if (round === wbRounds) return 'Final';
    if (round < wbRounds) return winnersRound(round, wbRounds);
    const isBronzeMatch = config['bronzeMatch'] !== false && round === wbRounds + lbRounds;
    return isBronzeMatch ? 'Bronze Final' : `Losers Round ${round - wbRounds}`;
  }

  if (round <= wbRounds) return winnersRound(round, wbRounds);
  if (round <= wbRounds + lbRounds) return `Losers Round ${round - wbRounds}`;
  return round === wbRounds + lbRounds + 1 ? 'Final' : 'Final (reset)';
}

// ── Filenames ─────────────────────────────────────────────────────────────────

/**
 * HEMA Ratings reads the tournament NAME out of the filename, so this keeps the
 * name legible (spaces, accents, case) and only removes what a filesystem or
 * zip entry cannot carry. Deliberately not the slugifier used for archive
 * reports, which would lowercase and hyphenate the name away.
 */
export function tournamentFileName(name: string): string {
  const cleaned = name
    // Path separators, the Windows-reserved set, and control characters.
    // Every other character (hyphens, ampersands, accents, apostrophes)
    // is part of the tournament name and must survive.
    // eslint-disable-next-line no-control-regex
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    // Windows rejects trailing dots and spaces in a filename.
    .replace(/[. ]+$/, '')
    .trim();
  return cleaned || 'Tournament';
}

// ── Gender token ──────────────────────────────────────────────────────────────

/**
 * Map a free-text persons.gender_category to the HEMA Ratings gender token.
 * They expect 'M' or 'F'; mixed/open/unknown categories export blank.
 * Recognizes English + French spellings (male/homme/masculin, female/femme…).
 */
export function hemaGender(genderCategory: string | null | undefined): string {
  const value = (genderCategory ?? '').trim().toLowerCase();
  if (!value) return '';
  if (/^(m|male|man|men|homme|masculin|h)\b/.test(value) || value === 'm') return 'M';
  if (/^(f|female|woman|women|w|femme|feminin|féminin)\b/.test(value) || value === 'f') return 'F';
  return '';
}

// ── CSV serialisation ─────────────────────────────────────────

/**
 * No UTF-8 BOM: it would land inside the first header cell of a naive parser,
 * which is a worse failure than Excel guessing the encoding on a file the
 * organiser is uploading rather than reading.
 */
export function toCsv(header: readonly string[], rows: string[][]): string {
  const lines = HEADER_ROW ? [header.map(csvEscape).join(',')] : [];
  for (const row of rows) lines.push(row.map(csvEscape).join(','));
  return lines.join('\n');
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
