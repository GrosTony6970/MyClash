import { csvFile, type CsvFormat } from '@myclash/types';
import { statusLabelKey, type RegistrationStatus } from '@myclash/ui';

/**
 * The roster's CSV (quick win O19, ruled 2026-10-14): exactly the rows on screen, one per
 * person, for the check-in desk. Name, club, Tournaments and their status, seed, referee
 * and instructor. Never the email, the birth date or the notes: the file leaves the app.
 *
 * With one Tournament's tab open, its status and seed get a column each. On "All", one
 * cell lists each Tournament with its status and seed.
 */

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
      const words = {
        tournament: entry.tournament,
        status: t(statusLabelKey('registration', entry.status)),
      };
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
  format: CsvFormat,
): string {
  const yesNo = (flag: boolean) =>
    flag ? t('organizer.persons.export.yes') : t('organizer.persons.export.no');
  const lines = rows.map((row) => {
    const flags = [yesNo(row.referee), yesNo(row.instructor)];
    if (!oneTournament) {
      return [row.name, row.club ?? '', tournamentsCell(row.registrations, t), ...flags];
    }
    const entry = row.registrations[0];
    const status = entry ? t(statusLabelKey('registration', entry.status)) : '';
    return [row.name, row.club ?? '', status, entry?.seed ?? '', ...flags];
  });
  return csvFile([header(oneTournament, t), ...lines], format);
}
