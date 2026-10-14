import { csvRow } from '@myclash/types';

/**
 * The roster's CSV (quick win O19, ruled 2026-10-14): exactly the rows on screen, one per
 * person, for the check-in desk. Name, club, Tournaments and their status, seed, referee
 * and instructor. Never the email, the birth date or the notes: the file leaves the app.
 *
 * With one Tournament's tab open, its status and seed get a column each. On "All", one
 * cell lists each Tournament with its status and seed.
 */

export type RegistrationStatus =
  'registered' | 'checked_in' | 'done' | 'withdrawn' | 'disqualified' | 'waitlist';

export interface RosterExportRow {
  name: string;
  club: string | null;
  registrations: ReadonlyArray<{
    tournament: string;
    status: RegistrationStatus;
    seed: number | null;
  }>;
  referee: boolean;
  instructor: boolean;
}

type Translator = (key: string, values?: Record<string, string | number>) => string;

interface RosterPerson {
  id: string;
  givenName: string;
  familyName: string;
  clubLabel: string | null;
  globalPersonId: string | null;
}

/**
 * The rows the table shows, in its order: each person with the Registrations of the open
 * tab (`'all'` = every one), as the table's own cells draw them.
 */
export function rosterRows(
  persons: readonly RosterPerson[],
  registrationsOf: ReadonlyMap<
    string,
    ReadonlyArray<{
      tournamentId: string;
      tournamentName: string;
      status: RegistrationStatus;
      seed: number | null;
    }>
  >,
  activeTab: string,
  refereeIds: ReadonlySet<string>,
  instructorIds: ReadonlySet<string>,
  nameOf: (person: RosterPerson) => string,
): RosterExportRow[] {
  return persons.map((person) => {
    const all = registrationsOf.get(person.id) ?? [];
    const shown = activeTab === 'all' ? all : all.filter((r) => r.tournamentId === activeTab);
    const id = person.globalPersonId;
    return {
      name: nameOf(person),
      club: person.clubLabel,
      registrations: shown.map((r) => ({
        tournament: r.tournamentName,
        status: r.status,
        seed: r.seed,
      })),
      referee: id !== null && refereeIds.has(id),
      instructor: id !== null && instructorIds.has(id),
    };
  });
}

// Literal keys, so the i18n sweep checks each word both ways.
const STATUS_WORD: Record<RegistrationStatus, string> = {
  registered: 'organizer.persons.export.status.registered',
  checked_in: 'organizer.persons.export.status.checked_in',
  done: 'organizer.persons.export.status.done',
  withdrawn: 'organizer.persons.export.status.withdrawn',
  disqualified: 'organizer.persons.export.status.disqualified',
  waitlist: 'organizer.persons.export.status.waitlist',
};

function header(oneTournament: boolean, t: Translator): string[] {
  const name = t('organizer.persons.export.name');
  const club = t('organizer.persons.export.club');
  const flags = [t('organizer.persons.export.referee'), t('organizer.persons.export.instructor')];
  return oneTournament
    ? [
        name,
        club,
        t('organizer.persons.export.statusColumn'),
        t('organizer.persons.export.seed'),
        ...flags,
      ]
    : [name, club, t('organizer.persons.export.tournaments'), ...flags];
}

/** "Longsword (Checked in, seed 3); Sabre (Registered)". */
function tournamentsCell(entries: RosterExportRow['registrations'], t: Translator): string {
  return entries
    .map((entry) => {
      const words = { tournament: entry.tournament, status: t(STATUS_WORD[entry.status]) };
      return entry.seed === null
        ? t('organizer.persons.export.entry', words)
        : t('organizer.persons.export.entrySeeded', { ...words, seed: entry.seed });
    })
    .join('; ');
}

/** The file's text, the byte-order mark first so a spreadsheet reads "Hélène" as written. */
export function rosterCsv(
  rows: readonly RosterExportRow[],
  oneTournament: boolean,
  t: Translator,
): string {
  const yesNo = (flag: boolean) =>
    flag ? t('organizer.persons.export.yes') : t('organizer.persons.export.no');
  const lines = rows.map((row) => {
    const flags = [yesNo(row.referee), yesNo(row.instructor)];
    if (!oneTournament) {
      return csvRow([row.name, row.club ?? '', tournamentsCell(row.registrations, t), ...flags]);
    }
    const entry = row.registrations[0];
    const status = entry ? t(STATUS_WORD[entry.status]) : '';
    return csvRow([row.name, row.club ?? '', status, entry?.seed ?? '', ...flags]);
  });
  return `\uFEFF${[csvRow(header(oneTournament, t)), ...lines].join('\r\n')}\r\n`;
}
