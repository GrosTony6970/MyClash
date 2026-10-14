/**
 * The columns a CSV import reads, and the header names each one is known by (O18, ruled
 * 2026-10-14): the English name, and the French one an organiser types in a French
 * spreadsheet. A header is matched in lower case, with its accents removed and its spaces,
 * hyphens and apostrophes read as `_`, so "Prénom", "E-mail" and "Date de naissance" are
 * `prenom`, `e_mail` and `date_de_naissance`.
 *
 * Each import names the columns it reads; a header that maps to none of them is listed as
 * "not read" on the preview (ruled 2026-10-15: any column this import ignores, not only a
 * name no import knows).
 */
const HEADER_NAMES = {
  given_name: ['given_name', 'first_name', 'firstname', 'prenom'],
  family_name: ['family_name', 'last_name', 'lastname', 'surname', 'nom', 'nom_de_famille'],
  display_name: ['display_name', 'nom_affiche'],
  email: ['email', 'e_mail', 'courriel', 'adresse_email', 'adresse_e_mail'],
  date_of_birth: ['date_of_birth', 'birth_date', 'birthdate', 'date_de_naissance'],
  club: ['club'],
  club_abv: ['club_abv', 'club_abbreviation', 'sigle_club', 'sigle_du_club'],
  club_city: ['club_city', 'ville_club', 'ville_du_club'],
  hema_ratings_id: ['hema_ratings_id', 'id_hema_ratings'],
  gender_category: ['gender_category', 'categorie'],
  notes: ['notes', 'remarques'],
  weapons: ['weapons', 'armes'],
  is_fighter: ['is_fighter', 'combattant'],
  is_referee: ['is_referee', 'arbitre'],
  is_workshop_participant: ['is_workshop_participant', 'participant_atelier'],
} as const;

export type CsvColumn = keyof typeof HEADER_NAMES;

/** What an Event's roster import reads (`PersonsService`): no display name, no role flags. */
export const EVENT_IMPORT_COLUMNS: readonly CsvColumn[] = [
  'given_name',
  'family_name',
  'email',
  'date_of_birth',
  'club',
  'club_abv',
  'club_city',
  'hema_ratings_id',
  'gender_category',
  'notes',
  'weapons',
];

/** What the super admin's Global Profiles import reads (`FightersService`): no notes. */
export const GLOBAL_IMPORT_COLUMNS: readonly CsvColumn[] = [
  'given_name',
  'family_name',
  'display_name',
  'email',
  'date_of_birth',
  'club',
  'club_abv',
  'club_city',
  'hema_ratings_id',
  'gender_category',
  'weapons',
  'is_fighter',
  'is_referee',
  'is_workshop_participant',
];

/** A header as it is matched: lower case, no accents, spaces / hyphens / apostrophes as `_`. */
export function headerKey(header: string): string {
  return header
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/[\s\-'’]+/gu, '_');
}

const COLUMN_BY_KEY = new Map<string, CsvColumn>(
  (Object.entries(HEADER_NAMES) as Array<[CsvColumn, readonly string[]]>).flatMap(
    ([column, names]) => names.map((name): [string, CsvColumn] => [name, column]),
  ),
);

/** The column a header names among `reads`, or null when this import does not read it. */
export function columnOf(header: string, reads: readonly CsvColumn[]): CsvColumn | null {
  const column = COLUMN_BY_KEY.get(headerKey(header));
  return column && reads.includes(column) ? column : null;
}
