import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ID_MAP_NAMES } from './archive.table-spec';
import type { CollectRule } from './archive.table-spec';
import {
  ARCHIVE_COLLECTED_TABLES,
  ARCHIVE_EXCLUDED_TABLES,
  ARCHIVE_TABLES,
  INSERT_ORDER,
  JSON_ID_PATHS,
  TABLE_TO_ARCHIVE_KEY,
  collectRuleFor,
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

describe('the collection graph', () => {
  const SCOPES = ['event', 'tournament'] as const;

  const rulesOf = (table: string) =>
    SCOPES.map((scope) => [scope, collectRuleFor(table as never, scope)] as const).filter(
      ([, rule]) => rule !== 'omit',
    ) as ReadonlyArray<readonly ['event' | 'tournament', Exclude<CollectRule, 'omit'>]>;

  it('points every rule at a table the registry declares', () => {
    const dangling: string[] = [];
    for (const table of names()) {
      for (const [scope, rule] of rulesOf(table)) {
        if (rule.from === 'root' || rule.from === 'event') continue;
        if (!ARCHIVE_COLLECTED_TABLES.has(rule.from)) {
          dangling.push(`${table}.collect.${scope}.from -> ${rule.from}`);
        }
      }
      for (const [scope, rule] of rulesOf(table)) {
        for (const need of rule.needs ?? []) {
          if (!ARCHIVE_COLLECTED_TABLES.has(need)) {
            dangling.push(`${table}.collect.${scope}.needs -> ${need}`);
          }
        }
      }
    }

    expect(dangling, 'a rule naming a table nothing declares collects nothing').toEqual([]);
  });

  it('gives every parent rule the column to match on', () => {
    const incomplete: string[] = [];
    for (const table of names()) {
      for (const [scope, rule] of rulesOf(table)) {
        if (rule.from === 'root' || rule.from === 'event') continue;
        if (!rule.local) incomplete.push(`${table}.collect.${scope}`);
      }
    }

    expect(
      incomplete,
      'without `local` there is no column to match the parent ids against',
    ).toEqual([]);
  });

  it('has every filter declare what it reads', () => {
    // `filter` runs against rows from OTHER tables via ctx.idsOf, and the driver
    // only resolves what `needs` names. A filter reading an unresolved table
    // silently sees an empty list and drops every row.
    const undeclared: string[] = [];
    for (const table of names()) {
      for (const [scope, rule] of rulesOf(table)) {
        if (rule.filter && (rule.needs ?? []).length === 0) {
          undeclared.push(`${table}.collect.${scope}`);
        }
      }
    }

    expect(undeclared).toEqual([]);
  });

  it('is acyclic, so on-demand resolution terminates', () => {
    // The driver throws on a cycle rather than hanging, but nobody should have
    // to discover one by exporting an event.
    const cycles: string[] = [];
    for (const scope of SCOPES) {
      const seen = new Set<string>();
      const walk = (table: string, trail: string[]): void => {
        if (trail.includes(table)) {
          cycles.push(`${scope}: ${[...trail, table].join(' -> ')}`);
          return;
        }
        if (seen.has(table)) return;
        seen.add(table);
        const rule = collectRuleFor(table as never, scope);
        if (rule === 'omit') return;
        const next = [...(rule.from === 'root' || rule.from === 'event' ? [] : [rule.from])];
        for (const need of rule.needs ?? []) next.push(need);
        for (const edge of next) walk(edge, [...trail, table]);
      };
      for (const table of names()) walk(table, []);
    }

    expect(cycles).toEqual([]);
  });

  it('roots the event archive at the event and the tournament archive at both', () => {
    expect(collectRuleFor('events', 'event')).toEqual({ from: 'root' });
    expect(collectRuleFor('events', 'tournament')).toEqual({ from: 'root' });
    // An event archive discovers its tournaments; a tournament archive is handed one.
    expect(collectRuleFor('tournaments', 'event')).toEqual({ from: 'event' });
    expect(collectRuleFor('tournaments', 'tournament')).toEqual({ from: 'root' });
  });

  it('keeps every scoring table out of a structure-only archive', () => {
    // The `include` flag replaced an `if (include === 'scoring')` block, and
    // these six are exactly what that block guarded.
    const scoringOnly = names().filter((table) =>
      rulesOf(table).some(([, rule]) => rule.include === 'scoring'),
    );

    expect(scoringOnly.sort()).toEqual(
      [
        'matches',
        'match_events',
        'exchanges',
        'match_penalties',
        'match_forfeits',
        'tournament_penalty_reviews',
      ].sort(),
    );
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

describe('the organiser can read every table name', () => {
  /**
   * The restore preview renders one row per archived table, labelled by
   * `t('organizer.archive.tables.<key>')`. Before that it rendered the envelope
   * key raw, so an organiser previewing a restore was shown
   * `eventProgrammeBlocks` and `personPrivacy`.
   *
   * The dictionary is read from disk rather than imported: @myclash/i18n is not
   * an API dependency, and the migration-coverage suite next door already reads
   * packages/db/migrations the same way. A dynamic `t()` key cannot be checked
   * by the i18n sweep, which is exactly why this exists.
   */
  const dictionary = (() => {
    const candidates = [
      path.resolve(process.cwd(), '../../packages/i18n/src/index.ts'),
      path.resolve(process.cwd(), 'packages/i18n/src/index.ts'),
      path.resolve(__dirname, '../../../../packages/i18n/src/index.ts'),
      path.resolve(__dirname, '../../../../../packages/i18n/src/index.ts'),
    ];
    const found = candidates.find((candidate) => existsSync(candidate));
    if (!found) throw new Error(`Could not locate packages/i18n/src/index.ts`);
    return readFileSync(found, 'utf8');
  })();

  /** Every `tables: { … }` block under `organizer.archive` — one per locale. */
  const localeBlocks = (() => {
    const blocks = [...dictionary.matchAll(/\n( *)tables: \{\n([\s\S]*?)\n\1\},\n/g)].map(
      (match) => match[2]!,
    );
    return blocks.filter((block) => /\n\s*eventProgrammeBlocks: /.test(block));
  })();

  it('finds both locale blocks (sanity check on the reader)', () => {
    // Without this, a regex that stopped matching would report every key as
    // missing — or, if the blocks vanished, assert nothing at all.
    expect(localeBlocks).toHaveLength(2);
  });

  it.each([0, 1])('labels every archived table in locale %i', (index) => {
    const block = localeBlocks[index] ?? '';
    const labelled = new Set([...block.matchAll(/^\s*([A-Za-z]+): /gm)].map((match) => match[1]!));

    const missing = names()
      .map((table) => TABLE_TO_ARCHIVE_KEY[table])
      .filter((key) => !labelled.has(key))
      .sort();

    expect(
      missing,
      `These archived tables have no label, so the restore preview would show ` +
        `the organiser a raw camelCase identifier. Add each to BOTH locales ` +
        `under organizer.archive.tables:\n` +
        missing.map((key) => `  - ${key}`).join('\n'),
    ).toEqual([]);
  });

  it('carries no label for a table the archive does not have', () => {
    const keys = new Set<string>(names().map((table) => TABLE_TO_ARCHIVE_KEY[table]));
    const stale = [...(localeBlocks[0] ?? '').matchAll(/^\s*([A-Za-z]+): /gm)]
      .map((match) => match[1]!)
      .filter((key) => !keys.has(key))
      .sort();

    expect(stale, 'a label nothing renders').toEqual([]);
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
