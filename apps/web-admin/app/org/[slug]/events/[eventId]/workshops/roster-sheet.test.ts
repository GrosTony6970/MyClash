import { describe, expect, it } from 'vitest';
import { CSV_EXCEL_FR, CSV_STANDARD } from '@myclash/types';
import {
  rosterCsvName,
  rosterSheetCsv,
  rosterSheetHtml,
  rosterSheetRows,
  type PrintLabels,
  type SheetEntry,
  type SheetHead,
} from './roster-sheet';

/**
 * A session's roster as a sign-in sheet (operator ruling 537). Saturday's "Longsword basics" has
 * three seats (Zoé Roux, Anne Martin, Léa Martin), two on the waiting list (Tom at 2, Ana at 1),
 * and Marc, refused by the instructor.
 */

const entry = (
  givenName: string,
  familyName: string,
  status: string,
  waitlistPosition: number | null = null,
  club: string | null = null,
): SheetEntry => ({
  status,
  waitlistPosition,
  persons: { givenName, familyName, clubs: club ? { name: club } : null },
});

const ROSTER: SheetEntry[] = [
  entry('Tom', 'Petit', 'waitlisted', 2),
  entry('Zoé', 'Roux', 'confirmed', null, 'Salle Lyon'),
  entry('Marc', 'Blanc', 'refused'),
  entry('Léa', 'Martin', 'confirmed'),
  entry('Ana', 'Durand', 'waitlisted', 1),
  entry('Anne', 'Martin', 'confirmed'),
];

const LABELS: PrintLabels = {
  name: 'Name',
  club: 'Club',
  place: 'Place',
  present: 'Present',
  seat: 'Seat',
  waitingAt: (n) => `Waiting list · ${n}`,
};
const HEAD: SheetHead = {
  title: 'Longsword basics',
  when: 'Sat 14 Nov, 10:00 – 11:30',
  cancelled: null,
  instructors: 'Instructors: Paul Roux',
  counts: 'Seats: 3 · Waiting list: 2',
};
const CSV_HEADERS = [
  'Family name',
  'Given name',
  'Club',
  'Place',
  'Waiting list position',
] as const;
const PLACES = { seat: 'Seat', waiting: 'Waiting list' };

describe('the lines of a sign-in sheet', () => {
  it('lists the seats by family then given name, then the waiting list in its order', () => {
    expect(rosterSheetRows(ROSTER, 'Unknown').map((r) => `${r.familyName} ${r.givenName}`)).toEqual(
      ['Martin Anne', 'Martin Léa', 'Roux Zoé', 'Durand Ana', 'Petit Tom'],
    );
  });

  it('leaves the refused person out', () => {
    expect(rosterSheetRows(ROSTER, 'Unknown').some((r) => r.familyName === 'Blanc')).toBe(false);
  });

  it('names a person whose roster row could not be read with the word handed in', () => {
    const rows = rosterSheetRows(
      [{ status: 'confirmed', waitlistPosition: null, persons: null }],
      'Unknown',
    );
    expect(rows).toEqual([{ familyName: 'Unknown', givenName: '', club: '', waiting: null }]);
  });
});

describe('the printed sheet', () => {
  const html = rosterSheetHtml(HEAD, rosterSheetRows(ROSTER, 'Unknown'), LABELS);

  it('heads it with the Workshop, the session, its instructors and its counts', () => {
    for (const text of [HEAD.title, HEAD.when!, HEAD.instructors!, HEAD.counts]) {
      expect(html).toContain(text);
    }
  });

  it('has an empty "Present" box on every line', () => {
    expect(html).toContain('<th>Present</th>');
    expect(html.match(/<td class="box narrow"><\/td>/g)).toHaveLength(5);
  });

  it('says a seat or the place on the waiting list', () => {
    expect(html).toContain('<td>Seat</td>');
    expect(html).toContain('<td>Waiting list · 1</td>');
  });

  it('marks a cancelled session in its heading', () => {
    const cancelled = rosterSheetHtml({ ...HEAD, cancelled: 'Cancelled' }, [], LABELS);
    expect(cancelled).toContain(`${HEAD.when} · Cancelled`);
  });

  it('escapes what organisers and attendees typed: title, instructor, name, club', () => {
    const typed = rosterSheetHtml(
      { ...HEAD, title: '<b>Sabre</b>', instructors: 'Instructors: <i>Al</i>' },
      rosterSheetRows([entry('<s>Jo</s>', 'Roux', 'confirmed', null, '<u>Club</u>')], 'Unknown'),
      LABELS,
    );
    for (const raw of ['<b>', '<i>', '<s>', '<u>']) expect(typed).not.toContain(raw);
    expect(typed).toContain('&lt;b&gt;Sabre&lt;/b&gt;');
    expect(typed).toContain('&lt;u&gt;Club&lt;/u&gt;');
  });
});

describe('the CSV of the sheet', () => {
  it('has the same lines, no "Present" column, and the waiting place as a number', () => {
    const csv = rosterSheetCsv(
      rosterSheetRows(ROSTER, 'Unknown'),
      CSV_HEADERS,
      PLACES,
      CSV_STANDARD,
    );
    // The file opens with a byte-order mark, so Excel reads it as UTF-8.
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines).toEqual([
      'Family name,Given name,Club,Place,Waiting list position',
      'Martin,Anne,,Seat,',
      'Martin,Léa,,Seat,',
      'Roux,Zoé,Salle Lyon,Seat,',
      'Durand,Ana,,Waiting list,1',
      'Petit,Tom,,Waiting list,2',
    ]);
  });

  it('splits on ";" for French Excel', () => {
    const csv = rosterSheetCsv(
      rosterSheetRows(ROSTER, 'Unknown'),
      CSV_HEADERS,
      PLACES,
      CSV_EXCEL_FR,
    );
    expect(csv).toContain('Durand;Ana;;Waiting list;1');
  });

  it('neutralises a name typed as a formula', () => {
    const rows = rosterSheetRows([entry('=cmd|calc', 'Roux', 'confirmed')], 'Unknown');
    expect(rosterSheetCsv(rows, CSV_HEADERS, PLACES, CSV_STANDARD)).toContain(`"'=cmd|calc"`);
  });

  it('names the file by the Workshop and the day, or the Workshop alone', () => {
    expect(rosterCsvName('longsword', '2026-11-14')).toBe('roster-longsword-2026-11-14.csv');
    expect(rosterCsvName('longsword', null)).toBe('roster-longsword.csv');
  });
});
