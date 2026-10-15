import { describe, expect, it } from 'vitest';
import { createTranslator, getMessages } from '@myclash/i18n';
import { CSV_EXCEL_FR, CSV_STANDARD } from '@myclash/types';
import { formatRosterName } from './roster-name';
import { rosterCsv, rosterRows } from './roster-export';

/**
 * O19 (ruled 2026-10-14): the roster's CSV holds the rows on screen, one per person: name,
 * club, Tournaments and status, seed, referee, instructor. Never the email, the birth date
 * or the notes.
 */

const t = createTranslator(getMessages('en'));

const ANA = {
  id: 'p-1',
  givenName: 'Hélène',
  familyName: 'Roux',
  email: 'helene@example.test',
  clubLabel: 'Lyon Escrime',
  globalPersonId: 'gp-1',
};
const BEN = {
  id: 'p-2',
  givenName: 'Ben',
  familyName: '=hyperlink("x")',
  email: 'ben@example.test',
  clubLabel: null,
  globalPersonId: null,
};
const REGISTRATIONS = new Map([
  [
    'p-1',
    [
      { tournamentId: 't-1', tournamentName: 'Longsword', status: 'checked_in' as const, seed: 3 },
      { tournamentId: 't-2', tournamentName: 'Sabre', status: 'registered' as const, seed: null },
    ],
  ],
  [
    'p-2',
    [{ tournamentId: 't-1', tournamentName: 'Longsword', status: 'waitlist' as const, seed: null }],
  ],
]);

const rows = (tab: string) =>
  rosterRows([ANA, BEN], REGISTRATIONS, tab, new Set(['gp-1']), new Set(), formatRosterName);

describe('the roster CSV', () => {
  it('lists every Tournament of a person, with its status and seed, on "All"', () => {
    const csv = rosterCsv(rows('all'), false, t, CSV_STANDARD);
    const [header, ana] = csv.slice(1).split('\r\n');
    expect(header).toBe('Name,Club,Tournaments,Referee,Instructor');
    expect(ana).toBe(
      'ROUX Hélène,Lyon Escrime,"Longsword (Checked in, seed 3); Sabre (Registered)",Yes,No',
    );
  });

  it('for French Excel, quotes the Tournaments cell: its own ; would split it', () => {
    const csv = rosterCsv(rows('all'), false, t, CSV_EXCEL_FR);
    expect(csv.slice(1).split('\r\n')[1]).toBe(
      'ROUX Hélène;Lyon Escrime;"Longsword (Checked in, seed 3); Sabre (Registered)";Yes;No',
    );
  });

  it("gives the open Tournament's status and seed a column each", () => {
    const csv = rosterCsv(rows('t-1'), true, t, CSV_STANDARD);
    expect(csv.slice(1).split('\r\n').slice(0, 3)).toEqual([
      'Name,Club,Status,Seed,Referee,Instructor',
      'ROUX Hélène,Lyon Escrime,Checked in,3,Yes,No',
      `"'=HYPERLINK(""X"") Ben",,Waiting list,,No,No`,
    ]);
  });

  it("holds the open tab's Tournament alone, even when it is not a person's first", () => {
    const csv = rosterCsv(rows('t-2'), true, t, CSV_STANDARD);
    // Ana is in Longsword first, Sabre second: on Sabre's tab her row is Sabre's.
    expect(csv.slice(1).split('\r\n')[1]).toBe('ROUX Hélène,Lyon Escrime,Registered,,Yes,No');
  });

  it('starts with the byte-order mark, and never holds an email', () => {
    const csv = rosterCsv(rows('all'), false, t, CSV_STANDARD);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).not.toContain('@example.test');
  });
});
