/**
 * A session's roster as a sign-in sheet (operator ruling 537): printed for the instructor, or a
 * CSV. Seats first, by family name; then the waiting list, in its order. Refused people are left
 * out. The printed page has a "Present" column: a mark for anyone already ticked, an empty box for
 * a pen; the CSV says the time of the tick (ruling 542).
 *
 * Pure. The page hands in the words, in the reader's language. Names, clubs and titles are
 * organiser or attendee input: HTML-escaped in print (`escapeHtml`), formula-safe in the CSV
 * (`csvFile`, the one owner of human-facing CSVs).
 */
import { csvFile, escapeHtml, type CsvFormat } from '@myclash/types';
import { printDocument } from '../print/print-shell';

/** A roster entry, as the roster read gives it. */
export interface SheetEntry {
  status: string;
  waitlistPosition: number | null;
  /** When the person was ticked present (rulings 539-547). */
  checkedInAt?: string | null;
  persons: { givenName: string; familyName: string; clubs: { name: string } | null } | null;
}

export interface SheetRow {
  familyName: string;
  givenName: string;
  club: string;
  /** The place on the waiting list; `null` for a seat. */
  waiting: number | null;
  /** When the person was ticked present, or `null` (ruling 542). */
  checkedInAt: string | null;
}

/** The sheet's lines. `unknown` names a person whose roster row could not be read. */
export function rosterSheetRows(roster: readonly SheetEntry[], unknown: string): SheetRow[] {
  const row = (e: SheetEntry): SheetRow => ({
    familyName: e.persons?.familyName ?? unknown,
    givenName: e.persons?.givenName ?? '',
    club: e.persons?.clubs?.name ?? '',
    waiting: e.status === 'waitlisted' ? (e.waitlistPosition ?? null) : null,
    checkedInAt: e.checkedInAt ?? null,
  });
  const byName = (a: SheetRow, b: SheetRow) =>
    a.familyName.localeCompare(b.familyName, undefined, { sensitivity: 'base' }) ||
    a.givenName.localeCompare(b.givenName, undefined, { sensitivity: 'base' });
  const seats = roster
    .filter((e) => e.status === 'confirmed')
    .map(row)
    .sort(byName);
  const waiting = roster
    .filter((e) => e.status === 'waitlisted')
    .map(row)
    .sort((a, b) => (a.waiting ?? Infinity) - (b.waiting ?? Infinity));
  return [...seats, ...waiting];
}

/** What the sheet's heading says of the session. */
export interface SheetHead {
  title: string;
  /** "Sat 14 Nov, 10:00 – 11:30"; `null` for a session not yet placed. */
  when: string | null;
  /** The word "Cancelled" for a cancelled session, else `null`. */
  cancelled: string | null;
  /** "Instructors: Anne Roux, Marc Petit", or `null` with none. */
  instructors: string | null;
  /** "Seats: 12 · Waiting list: 3". */
  counts: string;
}

/** The printed sheet's words. `waitingAt(n)` is "Waiting list · 3". */
export interface PrintLabels {
  name: string;
  club: string;
  place: string;
  present: string;
  seat: string;
  waitingAt: (position: number | null) => string;
}

export function rosterSheetHtml(
  head: SheetHead,
  rows: readonly SheetRow[],
  labels: PrintLabels,
): string {
  const subtitle = [head.when, head.cancelled].filter(Boolean).join(' · ');
  const meta = [head.instructors, head.counts].filter((s): s is string => Boolean(s));
  const body = rows
    .map(
      (r, i) =>
        `<tr><td class="narrow center">${i + 1}</td>` +
        `<td>${escapeHtml(`${r.familyName} ${r.givenName}`.trim())}</td>` +
        `<td>${escapeHtml(r.club)}</td>` +
        `<td>${escapeHtml(r.waiting === null ? labels.seat : labels.waitingAt(r.waiting))}</td>` +
        // Ticked already: a mark (542). Not yet: an empty box for a pen.
        `<td class="box narrow center">${r.checkedInAt ? '✓' : ''}</td></tr>`,
    )
    .join('');
  const columns = ['#', labels.name, labels.club, labels.place, labels.present]
    .map((c) => `<th>${escapeHtml(c)}</th>`)
    .join('');
  const sheet =
    `<div class="sheet"><div class="sheet-head"><div><h1>${escapeHtml(head.title)}</h1>` +
    (subtitle ? `<div style="font-size:11px;color:#555">${escapeHtml(subtitle)}</div>` : '') +
    `</div><div class="meta">${meta.map(escapeHtml).join('<br>')}</div></div>` +
    `<table><thead><tr>${columns}</tr></thead><tbody>${body}</tbody></table></div>`;
  return printDocument(head.title, [sheet]);
}

/** Family name, Given name, Club, Place, Waiting list position, Present. */
export type RosterCsvHeaders = readonly [string, string, string, string, string, string];

/** The CSV's "Place" words, "Seat" and "Waiting list", and the time of a tick. */
export interface CsvPlaces {
  seat: string;
  waiting: string;
  /** "10:02" on the Event's clock: when the person was ticked present (542). */
  presentAt: (iso: string) => string;
}

export function rosterSheetCsv(
  rows: readonly SheetRow[],
  headers: RosterCsvHeaders,
  places: CsvPlaces,
  format: CsvFormat,
): string {
  return csvFile(
    [
      headers,
      ...rows.map((r) => [
        r.familyName,
        r.givenName,
        r.club,
        r.waiting === null ? places.seat : places.waiting,
        // A plain number, so the column sorts.
        r.waiting === null ? '' : String(r.waiting),
        r.checkedInAt ? places.presentAt(r.checkedInAt) : '',
      ]),
    ],
    format,
  );
}

/** `roster-<workshop slug>-<day>.csv`; without a day for a session not yet placed. */
export function rosterCsvName(slug: string, day: string | null): string {
  return day ? `roster-${slug}-${day}.csv` : `roster-${slug}.csv`;
}
