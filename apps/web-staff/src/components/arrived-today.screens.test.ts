/**
 * Day 2 at the desk: "Arrived today" (operator ruling 547).
 *
 * The desk keeps one arrival per person for the whole Event. On Sunday, Léa, who arrived on
 * Saturday, showed "09:12" and only Undo: the volunteer could not mark her again without undoing
 * first. Her row now says the day ("Sat 09:12") and offers "Arrived today" beside Undo; it calls
 * the desk's one mark-arrived write, which ticks Sunday's Workshop sessions.
 *
 * web-staff has no React test setup, so the screens are read as text. These pins hold the WIRING;
 * `desk-view.test.ts` holds who counts as arrived on an earlier day.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...path: string[]) => readFileSync(join(__dirname, '..', ...path), 'utf8');
const desk = read('..', 'app', 'desk', 'page.tsx');
const button = read('components', 'MarkArrivedButton.tsx');

describe('the row of someone who arrived on an earlier day', () => {
  it('offers "Arrived today" with the desk’s one mark-arrived write, beside Undo', () => {
    expect(desk).toContain('const earlier = arrivedEarlierDay(person);');
    expect(desk).toMatch(
      /\{earlier && <MarkArrivedButton personId=\{person\.personId\} onMark=\{onMark\} today \/>\}\s+<button/,
    );
  });

  it('says the day of that arrival, not only its time', () => {
    expect(desk).toContain('{formatTime(person.arrivedAt, earlier)}');
    expect(desk).toMatch(/withDay\s+\? at\.toLocaleString\(undefined, \{ weekday: 'short'/);
  });

  it('labels the button "Arrived today" when asked', () => {
    expect(button).toContain(
      "{today ? t('scoring.desk.arrivedToday') : t('scoring.desk.markArrived')}",
    );
  });
});
