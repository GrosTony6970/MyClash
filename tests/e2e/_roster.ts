/**
 * A roster CSV made safe to import on a real stack: no row but the ones named
 * can reach a real person.
 *
 * Importing a roster sends nothing itself, but each row is matched to an
 * existing global profile by HEMA Ratings id, by name + club, or by email
 * (`global-person-resolver.service.ts`), and a row whose address matches the
 * profile's account is claimed for that account at once. From then on that real
 * person gets the demo's duty, bout, Workshop and results notices, their
 * followers get its alerts, and the real address on the roster row can be
 * mailed by a broadcast, a Workshop notice, the pass mail-out or a claim link.
 *
 * So every row NOT named in `linked` keeps only the columns in `SURVIVES` — its
 * name and role — and loses EVERY other cell, a column this file does not know
 * included. An allowlist, not a denylist: a column the importer learns later (or
 * an alias such as `courriel`) is blanked by default. Such a row can only mint a
 * fresh profile with no account, no address and no club.
 *
 * The club comes back after the import (`rosterClubs`), through the person edit:
 * it sets the club and matches no profile, so the demo has every club on its people
 * and still reaches no one.
 *
 * Headers are read the way the importer reads them (`csv-columns.ts`: lower
 * case, accents off, spaces / hyphens / apostrophes as `_`, English or French
 * name), and the separator is chosen by its rule (`detectCsvDelimiter`). Both
 * are copied, not imported: the e2e runner does not load app code. A copy that
 * falls behind only blanks more — it can never let an address through.
 *
 * `linked` names people, as "Given Family", who agreed to be linked and to get
 * the demo's notices. Each must match exactly one row, or this throws: a typo
 * must not silently isolate someone, nor link two people of one name.
 */

/** The importer's names for the columns a non-linked row keeps (`HEADER_NAMES`). */
const SURVIVES: Record<string, readonly string[]> = {
  given_name: ['given_name', 'first_name', 'firstname', 'prenom'],
  family_name: ['family_name', 'last_name', 'lastname', 'surname', 'nom', 'nom_de_famille'],
  display_name: ['display_name', 'nom_affiche'],
  weapons: ['weapons', 'armes'],
  is_fighter: ['is_fighter', 'combattant'],
  is_referee: ['is_referee', 'arbitre'],
  is_workshop_participant: ['is_workshop_participant', 'participant_atelier'],
};

const COLUMN_BY_KEY = new Map(
  Object.entries(SURVIVES).flatMap(([column, names]) => names.map((name) => [name, column])),
);

/** `headerKey` of `csv-columns.ts`. */
const headerKey = (header: string): string =>
  header
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/[\s\-'’]+/gu, '_');

/** A name compared the way the roster is: accents off, case off, spaces collapsed. */
export const fold = (name: string): string =>
  name.normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLowerCase();

/** The names in `E2E_POPULATE_LINKED`: "Given Family" entries, separated by `;`. */
export function linkedNames(value: string | undefined): string[] {
  return (value ?? '')
    .split(';')
    .map((name) => name.trim())
    .filter(Boolean);
}

/** The roster's lines and its header, read with the importer's separator and column names. */
function readRoster(csv: string) {
  const lines = csv
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
  const header = lines[0] ?? '';
  // Quoted cells are refused rather than mis-split: a shifted column would
  // blank the wrong field and keep an address.
  if (lines.some((line) => line.includes('"'))) {
    throw new Error('[e2e] isolateRoster reads unquoted CSV only; this roster has quoted cells');
  }
  // `detectCsvDelimiter`: ';' only when it strictly outnumbers ',' on the first line.
  const semis = header.split(';').length - 1;
  const commas = header.split(',').length - 1;
  const delimiter = semis > commas ? ';' : ',';

  const columns = header.split(delimiter).map((h) => COLUMN_BY_KEY.get(headerKey(h)) ?? null);
  const given = columns.indexOf('given_name');
  const family = columns.indexOf('family_name');
  if (given < 0 || family < 0) throw new Error('[e2e] roster has no given and family name columns');
  return { lines, header, delimiter, columns, given, family };
}

/** Each linked name was found exactly once: a typo or a shared name stops the run. */
function assertEachFoundOnce(wanted: ReadonlyMap<string, number>): void {
  const wrong = [...wanted].filter(([, count]) => count !== 1);
  if (wrong.length > 0) {
    throw new Error(
      `[e2e] E2E_POPULATE_LINKED must name people found exactly once in the roster: ` +
        wrong.map(([name, count]) => `"${name}" × ${count}`).join(', '),
    );
  }
}

export function isolateRoster(
  csv: string,
  linked: readonly string[],
): { csv: string; isolated: number; kept: number } {
  const { lines, header, delimiter, columns, given, family } = readRoster(csv);
  const wanted = new Map(linked.map((name) => [fold(name), 0]));
  let isolated = 0;
  const out = [header];
  for (const [index, line] of lines.slice(1).entries()) {
    const cells = line.split(delimiter);
    if (cells.length !== columns.length) {
      throw new Error(
        `[e2e] roster line ${index + 2} has ${cells.length} cells, its header ${columns.length}`,
      );
    }
    const name = fold(`${cells[given]} ${cells[family]}`);
    if (wanted.has(name)) {
      wanted.set(name, wanted.get(name)! + 1);
      out.push(line);
      continue;
    }
    out.push(cells.map((cell, i) => (columns[i] ? cell : '')).join(delimiter));
    isolated++;
  }
  assertEachFoundOnce(wanted);
  return { csv: `${out.join('\n')}\n`, isolated, kept: linked.length };
}

/** The importer's names for a row's club columns (`HEADER_NAMES`): read here, never sent. */
const CLUB_COLUMNS: Record<string, readonly string[]> = {
  club: ['club'],
  club_abv: ['club_abv', 'club_abbreviation', 'sigle_club', 'sigle_du_club'],
  club_city: ['club_city', 'ville_club', 'ville_du_club'],
};

const CLUB_COLUMN_BY_KEY = new Map(
  Object.entries(CLUB_COLUMNS).flatMap(([column, names]) => names.map((name) => [name, column])),
);

export interface RosterClub {
  name: string;
  abbreviation: string | null;
  city: string | null;
}

/**
 * Each roster person's club, by their folded "Given Family" name: what `isolateRoster` blanks
 * before the import. The demo gives it back after the import through the person edit, which sets
 * the club and matches no profile (`persons.service.ts` `update`). A row with no club name is left
 * out, and so is a name the roster holds twice: by name alone, the club could go to the wrong one.
 *
 * Read as strictly as `isolateRoster`: a line whose cell count is not its header's stops the run
 * (a shifted column would put another cell in the club's place), and so does a club cell holding
 * an `@` — an address never becomes a public club name.
 */
export function rosterClubs(csv: string): Map<string, RosterClub> {
  const { lines, header, delimiter, columns: kept, given, family } = readRoster(csv);
  const columns = header.split(delimiter).map((h) => CLUB_COLUMN_BY_KEY.get(headerKey(h)) ?? null);
  const at = (column: string) => columns.indexOf(column);
  const clubs = new Map<string, RosterClub>();
  const twice = new Set<string>();
  for (const [index, line] of lines.slice(1).entries()) {
    const cells = line.split(delimiter);
    if (cells.length !== kept.length) {
      throw new Error(
        `[e2e] roster line ${index + 2} has ${cells.length} cells, its header ${kept.length}`,
      );
    }
    const cell = (column: string) => (at(column) >= 0 ? cells[at(column)]!.trim() || null : null);
    const club = { name: cell('club'), abbreviation: cell('club_abv'), city: cell('club_city') };
    if (Object.values(club).some((value) => value?.includes('@'))) {
      throw new Error(`[e2e] roster line ${index + 2} has an address in a club cell`);
    }
    const person = fold(`${cells[given]} ${cells[family]}`);
    if (clubs.has(person) || twice.has(person)) twice.add(person);
    if (club.name) clubs.set(person, { ...club, name: club.name });
  }
  for (const person of twice) clubs.delete(person);
  return clubs;
}
