/**
 * archive-references.ts — the records an archive names but does not contain.
 *
 * A restore writes an archive table by table, one insert each and no
 * transaction (`ArchiveService.insertMappedTables`). An id with no entry in its
 * id map passes through unchanged (`mapFk`), so a reference to a record the
 * archive does not contain either points into the SOURCE event or names nothing
 * and fails its foreign key — after the Tournament, its phases and Pools are
 * already written. An edited or damaged archive can hold one, so the preview and
 * the restore both look before anything is written.
 *
 * What is checked, read off the registry (`archive.tables.ts`): every
 * foreign-key column the restore remaps, the shared sweep and each table's own
 * `fk`, against the ids of the table its id map names. And one reference made of
 * two columns, which no id map expresses (see `REFEREE_ROSTER_CHILDREN`).
 *
 * What is not, each on purpose:
 * - A column with a restore target (`event_id`, `tournament_id`): an unmapped
 *   value becomes the Event or Tournament restored into.
 * - A map no table in this archive can fill: `fighters` (global persons are in
 *   no archive), a table the scope omits, or a scoring table in a structure
 *   archive. A structure archive keeps match-scoped referee duties while it
 *   holds no Matches, so their `match_id` says nothing about the file.
 * - A `person_id` that names a global person, and `matches.referee_id` (see
 *   `ROSTER_REFERENCES`).
 * - A skill id: a system skill is shared by every event and passes through.
 * - An id inside a JSON column. It has no foreign key, so it cannot fail a
 *   restore, and a genuine archive can hold a stale one: force-deleting a
 *   registration (`assignments.service.ts`) leaves it named in a Swiss round's
 *   `pairing_meta_json.ranked`.
 */
import type { ArchiveRow, IdMapName } from './archive.table-spec';
import {
  ARCHIVE_TABLES,
  INSERT_ORDER,
  SHARED_FK_COLUMNS,
  TABLE_TO_ARCHIVE_KEY,
  collectRuleFor,
  idMapNameForTable,
  type ArchiveTableName,
} from './archive.tables';
import type { MyClashArchive } from './archive.types';

export interface DanglingReference {
  table: ArchiveTableName;
  column: string;
  id: string;
}

type Checked = Pick<MyClashArchive, 'scope' | 'include' | 'data'>;

/**
 * Where a column swept through the `persons` map names the Event's roster, and
 * so must be in the archive. Everywhere else `person_id` names a GLOBAL person
 * (migrations 0062 and 0099), which no archive contains, and the unmapped id
 * passing through is correct.
 *
 * `matches.referee_id` is a roster id (0039) but is not checked: this app can
 * leave it naming another Event's person. A Tournament restored into another
 * Event carries only the persons its registrations name, so a referee who did
 * not fight keeps the source id, and `PATCH /matches` accepts any person. An
 * archive of either Event would then be refused for a record the app wrote.
 */
const ROSTER_REFERENCES: ReadonlySet<string> = new Set([
  'registrations.person_id',
  'person_privacy.person_id',
]);

/**
 * Tables whose `(event_id, person_id)` references `event_referees` (migration
 * 0077). Every row of an archive shares its Event, so the person alone decides.
 */
const REFEREE_ROSTER_CHILDREN = ['event_referee_tournaments', 'event_referee_days'] as const;

const rowsIn = (archive: Checked, table: ArchiveTableName): ArchiveRow[] => {
  const rows = (archive.data as Partial<Record<string, unknown>>)[TABLE_TO_ARCHIVE_KEY[table]];
  return Array.isArray(rows) ? (rows as ArchiveRow[]) : [];
};

const stringsIn = (rows: ArchiveRow[], column: string): string[] =>
  rows.map((row) => row[column]).filter((value): value is string => typeof value === 'string');

/** The ids of each id map this archive can fill in its scope. See the header for what it cannot. */
function carriedIds(archive: Checked): Map<IdMapName, Set<string>> {
  const carried = new Map<IdMapName, Set<string>>();
  for (const table of INSERT_ORDER) {
    const map = idMapNameForTable(table);
    const rule = collectRuleFor(table, archive.scope);
    if (!map || rule === 'omit') continue;
    if (rule.include === 'scoring' && archive.include !== 'scoring') continue;
    carried.set(map, new Set(stringsIn(rowsIn(archive, table), 'id')));
  }
  return carried;
}

/** The foreign-key columns the restore remaps on `table`, each with the ids it must name. */
function checkedColumns(
  table: ArchiveTableName,
  carried: Map<IdMapName, Set<string>>,
): Array<[string, Set<string>]> {
  const shared = Object.entries(SHARED_FK_COLUMNS)
    .filter(([, column]) => column.target === undefined)
    .map(([name, column]): [string, IdMapName] => [name, column.map]);
  const own = Object.entries(ARCHIVE_TABLES[table]!.fk ?? {});
  return [...shared, ...own].flatMap(([column, map]): Array<[string, Set<string>]> => {
    const ids = carried.get(map);
    if (!ids) return [];
    if (map === 'persons' && !ROSTER_REFERENCES.has(`${table}.${column}`)) return [];
    return [[column, ids]];
  });
}

/** Every reference in `archive` to a record it does not contain, in insert order. */
export function danglingReferences(archive: Checked): DanglingReference[] {
  const carried = carriedIds(archive);
  const dangling: DanglingReference[] = [];
  const check = (table: ArchiveTableName, column: string, ids: Set<string>) => {
    for (const id of stringsIn(rowsIn(archive, table), column)) {
      if (!ids.has(id)) dangling.push({ table, column, id });
    }
  };
  for (const table of INSERT_ORDER) {
    for (const [column, ids] of checkedColumns(table, carried)) check(table, column, ids);
  }
  const referees = new Set(stringsIn(rowsIn(archive, 'event_referees'), 'person_id'));
  for (const table of REFEREE_ROSTER_CHILDREN) check(table, 'person_id', referees);
  return dangling;
}

/** How many references the message spells out before it counts the rest. */
const NAMED = 5;

/** The one wording of the refusal: the preview shows it, and the restore answers 400 with it. */
export function describeDangling(dangling: readonly DanglingReference[]): string {
  const named = dangling.slice(0, NAMED).map(({ table, column, id }) => `${table}.${column} ${id}`);
  const rest = dangling.length > NAMED ? `, and ${dangling.length - NAMED} more` : '';
  return `This archive refers to ${dangling.length} record(s) it does not contain, so it cannot be restored: ${named.join(', ')}${rest}.`;
}
