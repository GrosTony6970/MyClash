import { describe, expect, it } from 'vitest';
import { ID_MAP_NAMES } from './archive.table-spec';
import {
  ARCHIVE_COLLECTED_TABLES,
  ARCHIVE_EXCLUDED_TABLES,
  ARCHIVE_TABLES,
  INSERT_ORDER,
  JSON_ID_PATHS,
  TABLE_TO_ARCHIVE_KEY,
  emptyArchiveTables,
  idMapNameForTable,
  jsonIdPathsFor,
} from './archive.tables';

/**
 * Referential integrity for the archive's one table list.
 *
 * The registry replaced six hand-maintained declarations, four of which could
 * only disagree with each other. These assertions cover what a type cannot: a
 * name that points at nothing, a key claimed twice, an ordering that stopped
 * meaning what its comments say it means.
 */

const names = () => [...INSERT_ORDER];

describe('the registry is internally consistent', () => {
  it('gives every table a distinct envelope key', () => {
    const keys = names().map((table) => TABLE_TO_ARCHIVE_KEY[table]);
    const duplicated = keys.filter((key, index) => keys.indexOf(key) !== index);

    expect(
      duplicated,
      'two tables claiming one envelope key would silently overwrite each other on export',
    ).toEqual([]);
    expect(keys).toHaveLength(names().length);
  });

  it('names only id maps that exist', () => {
    const known = new Set<string>(ID_MAP_NAMES);
    const unknown = names()
      .map((table) => [table, idMapNameForTable(table)] as const)
      .filter(([, map]) => map !== undefined && !known.has(map))
      .map(([table, map]) => `${table} -> ${map}`);

    expect(unknown, 'add the map to ID_MAP_NAMES, or use the generic fallback').toEqual([]);
  });

  it('resolves every JSON path to a real id map', () => {
    const known = new Set<string>(ID_MAP_NAMES);
    const unknown: string[] = [];
    for (const table of names()) {
      for (const { path, map } of jsonIdPathsFor(table)) {
        if (!known.has(map)) unknown.push(`${table}.${path} -> ${map}`);
      }
    }

    expect(unknown).toEqual([]);
  });

  it('declares JSON paths only for tables it declares at all', () => {
    const stray = Object.keys(JSON_ID_PATHS).filter(
      (table) => !ARCHIVE_COLLECTED_TABLES.has(table),
    );
    expect(stray, 'a JSON path on a table the archive does not carry remaps nothing').toEqual([]);
  });

  it('carries no table on both sides of the archive/excluded fence', () => {
    const overlap = names().filter((table) => ARCHIVE_EXCLUDED_TABLES.has(table));
    expect(overlap).toEqual([]);
  });
});

describe('the derived declarations agree, because they are derived', () => {
  /**
   * This is the whole point of the registry. Before it, these four lists were
   * written out by hand and two of them — the insert order and the collection
   * call — failed SILENTLY when a table was missed: it was exported and never
   * restored, or carried as an empty array, with every gate still green.
   */
  it('derives the insert order from the declaration order, covering every table', () => {
    expect(INSERT_ORDER).toEqual(Object.keys(ARCHIVE_TABLES));
    expect(new Set(INSERT_ORDER).size, 'a table declared twice').toBe(INSERT_ORDER.length);
  });

  it('gives the table→key map and the empty snapshot the same keys', () => {
    expect(Object.keys(TABLE_TO_ARCHIVE_KEY).sort()).toEqual(names().sort());
    expect(Object.keys(emptyArchiveTables()).sort()).toEqual(
      names()
        .map((table) => TABLE_TO_ARCHIVE_KEY[table])
        .sort(),
    );
  });

  it('reports every declared table as collected', () => {
    expect([...ARCHIVE_COLLECTED_TABLES].sort()).toEqual(names().sort());
  });
});

describe('the empty snapshot', () => {
  it('hands out fresh arrays, not one shared per table', () => {
    // The constant it replaced was spread into every snapshot, so two archives
    // built in the same process held the SAME empty array for every table
    // neither filled. Nothing pushes into one today — every collector assigns —
    // and this keeps it that way cheaply.
    const first = emptyArchiveTables();
    const second = emptyArchiveTables();

    expect(first.events).not.toBe(second.events);
    first.events.push({ id: 'e-1' });
    expect(second.events).toEqual([]);
  });

  it('starts every table empty', () => {
    const empty = emptyArchiveTables();
    expect(Object.values(empty).every((rows) => rows.length === 0)).toBe(true);
  });
});

describe('the ordering notes are load-bearing', () => {
  const orderOf = (table: string) => INSERT_ORDER.indexOf(table as never);

  /**
   * Declaration order IS insert order, so these are FK constraints, not
   * preferences. Each pair is a foreign key `remapRow` threads or the database
   * enforces; getting one backwards writes a child before its parent exists.
   */
  it.each([
    ['events', 'tournaments', 'tournaments.event_id'],
    ['persons', 'registrations', 'registrations.person_id'],
    ['referee_skills', 'event_hidden_skills', 'event_hidden_skills.skill_id'],
    ['referee_skills', 'referee_assignments', 'referee_assignments.role holds a skill id'],
    ['referee_skills', 'tournament_slot_allowed_skills', 'the slot-config skill join'],
    ['event_slot_config_default', 'event_slot_config_default_skills', 'slot_config_id'],
    ['tournament_slot_config', 'tournament_slot_allowed_skills', 'slot_config_id'],
    ['event_referees', 'event_referee_tournaments', 'the per-tournament allowlist'],
    ['event_referees', 'event_referee_days', 'the per-day allowlist'],
    ['tournaments', 'registrations', 'registrations.tournament_id'],
    ['tournaments', 'phases', 'phases.tournament_id'],
    ['phases', 'pools', 'pools.phase_id'],
    ['pools', 'pool_members', 'pool_members.pool_id'],
    ['phases', 'bracket_slots', 'bracket_slots.phase_id'],
    ['swiss_rounds', 'matches', 'matches.swiss_round_id'],
    ['bracket_slots', 'matches', 'matches.bracket_slot_id'],
    ['matches', 'exchanges', 'exchanges.match_id'],
    ['matches', 'match_penalties', 'match_penalties.match_id'],
    ['match_penalties', 'tournament_penalty_reviews', 'the penalty ids in payload_json'],
    ['matches', 'match_forfeits', 'match_forfeits.match_id'],
    ['tournaments', 'event_programme_blocks', 'event_programme_blocks.competition_id'],
    ['workshops', 'event_programme_blocks', 'event_programme_blocks.workshop_id'],
    ['workshops', 'workshop_sessions', 'workshop_sessions.workshop_id'],
    ['workshop_sessions', 'workshop_enrollments', 'workshop_enrollments.workshop_session_id'],
  ])('inserts %s before %s (%s)', (parent, child) => {
    expect(orderOf(parent)).toBeGreaterThanOrEqual(0);
    expect(orderOf(child)).toBeGreaterThanOrEqual(0);
    expect(orderOf(parent)).toBeLessThan(orderOf(child));
  });
});
