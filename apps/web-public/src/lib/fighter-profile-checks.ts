/**
 * What stops a fighter's profile from being saved (quick-win M1, operator 2026-10-14).
 *
 * A half-typed year or an unfinished medal row used to be dropped in silence: the page said
 * "Profile saved" while the server cleared the start year, or deleted a saved medal (medals are
 * replaced whole). Now Save stops and points at the field. A medal row with NOTHING typed in it is
 * still dropped quietly: it is a row added and left, not an unfinished one.
 */

/** The API's floor (`PROFILE_YEAR_MIN` of `apps/api/.../fighters.dto.ts`), pinned by a test. */
export const PROFILE_YEAR_MIN = 2000;

export interface MedalRowInput {
  competition: string;
  year: string;
  weapon: string;
}

export type YearProblem = 'yearRange';
export type MedalProblem = 'competitionMissing' | 'yearMissing' | 'yearRange' | 'weaponMissing';

export interface ProfileProblems {
  practicingSince: YearProblem | null;
  /** One list per medal row, in the form's order; an empty list = nothing wrong. */
  medals: MedalProblem[][];
}

/** `thisYear` is the phone's year: never later than the server's (UTC+14). */
function yearInRange(typed: string, thisYear: number): boolean {
  const year = Number(typed);
  return Number.isInteger(year) && year >= PROFILE_YEAR_MIN && year <= thisYear;
}

export function medalRowIsEmpty(row: MedalRowInput): boolean {
  return !row.competition.trim() && !row.year.trim() && !row.weapon;
}

function medalProblems(row: MedalRowInput, thisYear: number): MedalProblem[] {
  if (medalRowIsEmpty(row)) return [];
  const problems: MedalProblem[] = [];
  if (!row.competition.trim()) problems.push('competitionMissing');
  if (!row.year.trim()) problems.push('yearMissing');
  else if (!yearInRange(row.year.trim(), thisYear)) problems.push('yearRange');
  if (!row.weapon) problems.push('weaponMissing');
  return problems;
}

export function profileFormProblems(
  form: { practicingSince: string; medals: MedalRowInput[] },
  thisYear: number,
): ProfileProblems {
  const since = form.practicingSince.trim();
  return {
    // An empty start year clears it: that is a choice, not a mistake.
    practicingSince: since && !yearInRange(since, thisYear) ? 'yearRange' : null,
    medals: form.medals.map((row) => medalProblems(row, thisYear)),
  };
}

export function hasProblems(problems: ProfileProblems): boolean {
  return problems.practicingSince !== null || problems.medals.some((row) => row.length > 0);
}
