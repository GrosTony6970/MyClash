import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  hasProblems,
  medalRowIsEmpty,
  PROFILE_YEAR_MIN,
  profileFormProblems,
  type MedalRowInput,
} from './fighter-profile-checks';

const row = (patch: Partial<MedalRowInput> = {}): MedalRowInput => ({
  competition: 'Open de Lyon',
  year: '2024',
  weapon: 'Sabre',
  ...patch,
});
const EMPTY: MedalRowInput = { competition: '', year: '', weapon: '' };

describe('profileFormProblems', () => {
  it('finds nothing in a form with an empty start year and no medal', () => {
    const problems = profileFormProblems({ practicingSince: '', medals: [] }, 2026);
    expect(problems).toEqual({ practicingSince: null, medals: [] });
    expect(hasProblems(problems)).toBe(false);
  });

  it('refuses a half-typed start year, and one before 2000 or after this year', () => {
    for (const typed of ['20', '1999', '2027']) {
      const problems = profileFormProblems({ practicingSince: typed, medals: [] }, 2026);
      expect(problems.practicingSince, typed).toBe('yearRange');
      expect(hasProblems(problems), typed).toBe(true);
    }
  });

  it('takes 2000 and this year as a start year', () => {
    expect(profileFormProblems({ practicingSince: '2000', medals: [] }, 2026).practicingSince).toBe(
      null,
    );
    expect(profileFormProblems({ practicingSince: '2026', medals: [] }, 2026).practicingSince).toBe(
      null,
    );
  });

  it('names what each unfinished medal row is missing, row by row', () => {
    const problems = profileFormProblems(
      {
        practicingSince: '',
        medals: [
          row(),
          row({ weapon: '' }),
          row({ competition: '  ', year: '' }),
          row({ year: '20' }),
        ],
      },
      2026,
    );
    expect(problems.medals).toEqual([
      [],
      ['weaponMissing'],
      ['competitionMissing', 'yearMissing'],
      ['yearRange'],
    ]);
    expect(hasProblems(problems)).toBe(true);
  });

  it('refuses a medal from before 2000 or from next year', () => {
    const problems = profileFormProblems(
      { practicingSince: '', medals: [row({ year: '1998' }), row({ year: '2027' })] },
      2026,
    );
    expect(problems.medals).toEqual([['yearRange'], ['yearRange']]);
  });

  it('lets a row with nothing typed in it pass: it is dropped, not refused', () => {
    const problems = profileFormProblems({ practicingSince: '', medals: [EMPTY, row()] }, 2026);
    expect(problems.medals).toEqual([[], []]);
    expect(hasProblems(problems)).toBe(false);
  });
});

describe('medalRowIsEmpty', () => {
  it('is true only when the competition, the year and the weapon are all blank', () => {
    expect(medalRowIsEmpty(EMPTY)).toBe(true);
    expect(medalRowIsEmpty({ ...EMPTY, competition: '   ' })).toBe(true);
    expect(medalRowIsEmpty({ ...EMPTY, year: '2' })).toBe(false);
    expect(medalRowIsEmpty({ ...EMPTY, weapon: 'Sabre' })).toBe(false);
    expect(medalRowIsEmpty({ ...EMPTY, competition: 'O' })).toBe(false);
  });
});

describe('PROFILE_YEAR_MIN', () => {
  it("is the API's own floor", () => {
    const api = readFileSync(
      join(__dirname, '../../../api/src/modules/fighters/dto/fighters.dto.ts'),
      'utf8',
    );
    expect(api).toContain('export const PROFILE_YEAR_MIN = 2000;');
    expect(PROFILE_YEAR_MIN).toBe(2000);
  });
});
