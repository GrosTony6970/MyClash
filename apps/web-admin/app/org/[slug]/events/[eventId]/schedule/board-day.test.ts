import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boardOpeningDay } from './board-day';

/**
 * The page draws the board again after each Generate and each Save of the planner. It then
 * opened on its first day again, wherever the organiser was. It now opens on the day it showed.
 */
const DAYS = ['2027-06-01', '2027-06-02', '2027-06-03'];
const TZ = 'Europe/Paris';
const BEFORE = '2027-05-01T08:00:00.000Z';

describe('boardOpeningDay', () => {
  it('opens on the day the board showed before it was drawn again', () => {
    expect(boardOpeningDay(DAYS, TZ, BEFORE, '2027-06-02')).toBe('2027-06-02');
  });

  it('opens on today, or on day 1, when there is no day to keep or the Event lost it', () => {
    expect(boardOpeningDay(DAYS, TZ, BEFORE, null)).toBe('2027-06-01');
    expect(boardOpeningDay(DAYS, TZ, '2027-06-03T09:00:00.000Z', null)).toBe('2027-06-03');
    expect(boardOpeningDay(DAYS, TZ, BEFORE, '2027-07-01')).toBe('2027-06-01');
  });

  // A text pin: no test mounts the board (it reads the API and realtime).
  it('is kept by the page across the board drawn again', () => {
    const page = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
    expect(page).toMatch(/keptDay=\{boardDay\}\s+onDayChange=\{setBoardDay\}/);
    const data = readFileSync(join(__dirname, 'useScheduleData.ts'), 'utf8');
    expect(data).toMatch(
      /boardOpeningDay\(days, timezone, new Date\(\)\.toISOString\(\), keptDay\)/,
    );
  });
});
