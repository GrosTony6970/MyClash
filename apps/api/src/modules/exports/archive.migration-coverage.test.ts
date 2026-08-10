import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildMigrationSchema } from '../../common/testing/migration-schema';
import {
  ARCHIVE_COLLECTED_TABLES,
  ARCHIVE_EXCLUDED_TABLES,
  JSON_ID_PATHS,
} from './archive.service';

/**
 * Anti-rot guard for the organizer archive, in two layers.
 *
 * 1. TABLE coverage — every event/tournament/phase-scoped table is either
 *    collected or consciously excluded.
 * 2. COLUMN coverage — on a collected table, every `*_id`/`*_ids` column is
 *    either remapped by `remapRow` or consciously listed as not-remapped, and
 *    every JSON column either declares its nested ids in `JSON_ID_PATHS` or is
 *    consciously listed as id-free.
 *
 * Layer 2 is the one that would have caught `exchanges.corrected_exchange_id`
 * (a plain column nobody ever listed) and `tournament_penalty_reviews.
 * payload_json` (penalty ids inside a JSON blob, found by writing this test).
 * Both had satisfied FKs — the source rows still exist — so a restore succeeded
 * and produced a copy quietly referencing another event.
 *
 * WHAT NEITHER LAYER CAN CATCH: a new KEY added inside a JSON column that is
 * already declared or already allowlisted. `swiss_rounds.pairing_meta_json` is
 * covered by ten paths; an eleventh id added to that blob tomorrow is invisible
 * here, because nothing in the schema records what lives inside a `jsonb`. The
 * sentinel sweep in `archive.service.test.ts` is the partial answer — it
 * deep-walks a restored fixture and refuses any surviving source id — but it
 * only sees shapes the fixture contains. Adding an id to a JSON column still
 * needs a human to add its path.
 *
 * `phase_id` counts in layer 1 because the guard was blind to it and that
 * blindness was load-bearing: `swiss_rounds` and `swiss_entrants` are
 * phase-scoped and carry every pairing a Swiss phase ever produced, yet neither
 * would have been flagged. The three tables that were already phase-scoped
 * (pools, bracket_slots, matches) were all archived, so widening the scan costs
 * nothing and closes the hole for the next one.
 */

function findMigrationsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), '../../packages/db/migrations'), // cwd = apps/api
    path.resolve(process.cwd(), 'packages/db/migrations'), // cwd = repo root
    path.resolve(__dirname, '../../../../packages/db/migrations'),
    path.resolve(__dirname, '../../../../../packages/db/migrations'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not locate packages/db/migrations (looked in: ${candidates.join(', ')})`);
}

function loadMigrationSql(): string {
  const dir = findMigrationsDir();
  return readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => readFileSync(path.join(dir, file), 'utf8'))
    .join('\n');
}

/** Table names with an event_id, tournament_id or phase_id column (CREATE or ALTER). */
function scopedTablesFromMigrations(sql: string): { scoped: Set<string>; all: Set<string> } {
  const scoped = new Set<string>();
  const all = new Set<string>();

  // CREATE TABLE [IF NOT EXISTS] [public.]"name" ( ...body... \n);
  const createRe =
    /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\s*\);/gi;
  let match: RegExpExecArray | null;
  while ((match = createRe.exec(sql)) !== null) {
    const name = match[1]!.toLowerCase();
    const body = match[2]!;
    all.add(name);
    if (/\bevent_id\b/.test(body) || /\btournament_id\b/.test(body) || /\bphase_id\b/.test(body)) {
      scoped.add(name);
    }
  }

  // ALTER TABLE name ... ADD COLUMN [IF NOT EXISTS] event_id|tournament_id
  for (const statement of sql.split(';')) {
    const alter = /ALTER TABLE\s+(?:public\.)?"?(\w+)"?/i.exec(statement);
    if (
      alter &&
      /ADD COLUMN(?:\s+IF NOT EXISTS)?\s+(?:event_id|tournament_id|phase_id)\b/i.test(statement)
    ) {
      scoped.add(alter[1]!.toLowerCase());
    }
  }

  return { scoped, all };
}

describe('archive migration coverage', () => {
  const sql = loadMigrationSql();
  const { scoped, all } = scopedTablesFromMigrations(sql);

  it('finds a meaningful set of scoped tables (sanity check on the scanner)', () => {
    // If the regex breaks, this catches it before the real assertion misleads.
    expect(all.has('events')).toBe(true);
    expect(all.has('tournaments')).toBe(true);
    expect(scoped.has('registrations')).toBe(true);
    expect(scoped.size).toBeGreaterThan(15);
  });

  it('every event/tournament-scoped table is either archived or explicitly excluded', () => {
    const unbucketed = [...scoped]
      .filter(
        (table) => !ARCHIVE_COLLECTED_TABLES.has(table) && !ARCHIVE_EXCLUDED_TABLES.has(table),
      )
      .sort();

    expect(
      unbucketed,
      `These scoped tables are neither collected by the archive nor listed in ` +
        `ARCHIVE_EXCLUDED_TABLES. Add each to the archive (TABLE_TO_ARCHIVE_KEY + ` +
        `collect* + INSERT_ORDER) or, if it must not be copied, to ARCHIVE_EXCLUDED_TABLES:\n` +
        unbucketed.map((t) => `  - ${t}`).join('\n'),
    ).toEqual([]);
  });

  it('excluded tables are real tables (guards against typos / dead entries)', () => {
    const unknown = [...ARCHIVE_EXCLUDED_TABLES].filter((table) => !all.has(table)).sort();
    expect(unknown, `ARCHIVE_EXCLUDED_TABLES names tables that no migration creates`).toEqual([]);
  });

  it('no table is both collected and excluded', () => {
    const overlap = [...ARCHIVE_COLLECTED_TABLES].filter((table) =>
      ARCHIVE_EXCLUDED_TABLES.has(table),
    );
    expect(overlap).toEqual([]);
  });
});

/**
 * JSON columns on archived tables that carry NO ids.
 *
 * Every entry was read off what writes it, not assumed:
 *   matches.rounds_json            — ClosedRound[] (round, scores, winner
 *                                    COLOUR, end reason). No ids by design.
 *   tournaments.ruleset_config     — the @myclash/rulesets config. Its schema
 *                                    declares no id field at all; a custom
 *                                    ruleset is referenced by code + version.
 *   tournaments.scoring_config_json — TournamentScoringConfig (afterblow mode,
 *                                    buttons, display).
 *   tournaments.lock_config_json   — TournamentLockConfig (four booleans and a
 *                                    delay).
 *   referee_assignments.conflicts_jsonb
 *                                  — written as `[]` by all three of its
 *                                    writers and read by nothing. If it ever
 *                                    carries real conflict detail, that detail
 *                                    will name matches and pools, and this
 *                                    entry must become a JSON_ID_PATHS one.
 */
const JSON_COLUMNS_WITHOUT_IDS = new Set<string>([
  'matches.rounds_json',
  'tournaments.ruleset_config',
  'tournaments.scoring_config_json',
  'tournaments.lock_config_json',
  'referee_assignments.conflicts_jsonb',
]);

/**
 * `*_id` columns on archived tables that `remapRow` deliberately leaves alone.
 *
 * Three reasons, and each entry has exactly one:
 *   - AUTH / STAFF actors. `auth.users` and `event_staff_accounts` are not part
 *     of an archive (staff accounts are explicitly excluded), so who did a thing
 *     survives as a plain reference. Restoring a copy does not re-issue staff.
 *   - ORG-LEVEL catalogues. Rulesets, venues, compensation plans and clubs live
 *     beside the event, not inside it — they resolve on a same-org restore, and
 *     `remapRow` nulls the cross-org ones per table.
 *   - EXTERNAL identifiers. `hema_ratings_id` names a row in someone else's
 *     database.
 *
 * `events.organization_id` is here for a fourth reason: the restore sets it
 * from `targetOrganizationId` on the event row itself, not through the FK sweep.
 */
const FK_COLUMNS_NOT_REMAPPED = new Set<string>([
  // auth users / staff accounts
  'events.created_by_user_id',
  'exchanges.staff_account_id',
  'match_events.by_user_id',
  'match_events.staff_account_id',
  'match_forfeits.by_user_id',
  'match_forfeits.staff_account_id',
  'match_forfeits.voided_by_user_id',
  'match_forfeits.voided_by_staff_account_id',
  'match_penalties.by_user_id',
  'match_penalties.staff_account_id',
  'matches.locked_by_user_id',
  'matches.locked_by_staff_account_id',
  'matches.scorekeeper_user_id',
  'persons.created_by_user_id',
  'phases.published_by_user_id',
  'tournament_penalty_reviews.reviewed_by_user_id',
  'workshop_enrollments.user_id',
  // org-level catalogues, shared across events
  'events.organization_id',
  'events.penalty_ruleset_id',
  'tournaments.penalty_ruleset_id',
  'persons.club_id',
  'referee_compensation_event_settings.plan_id',
  // external identifier
  'persons.hema_ratings_id',
]);

/**
 * The columns `remapRow` actually touches, read off the source.
 *
 * A source scan rather than an exported list, because an exported list would be
 * a second thing to keep in step and the second one always rots. DELIBERATELY
 * NARROW: it recognises `mapFk(next, 'x'` and `next['x'] =`, and nothing else.
 * That narrowness is only safe because the count is asserted against a floor
 * below — a parser that quietly stopped matching would otherwise report every
 * column as unhandled and read as a catastrophic failure, or (worse, if the
 * assertion were inverted) as success.
 */
function remappedColumnsFromSource(): Set<string> {
  const source = readFileSync(path.resolve(__dirname, 'archive.service.ts'), 'utf8');
  const handled = new Set<string>();
  for (const match of source.matchAll(/mapFk\(\s*next,\s*'([a-z_]+)'/g)) handled.add(match[1]!);
  for (const match of source.matchAll(/next\['([a-z_]+)'\]\s*=/g)) handled.add(match[1]!);
  return handled;
}

/** The COLUMN each declared JSON path starts at — `a.b[].c` → `a`. */
function jsonColumnsWithDeclaredPaths(table: string): Set<string> {
  const declared = (JSON_ID_PATHS as Record<string, readonly { path: string }[]>)[table] ?? [];
  return new Set(declared.map((entry) => entry.path.split(/[.[]/)[0]!));
}

describe('archive column coverage', () => {
  const { columns, jsonColumns } = buildMigrationSchema();
  const remapped = remappedColumnsFromSource();

  it('resolves a meaningful set of remapped columns (sanity check on the scanner)', () => {
    // Without this floor a scanner that matched nothing would make the two
    // assertions below scream about every column, or — with one typo in a
    // regex — quietly stop testing anything at all.
    expect(remapped.has('event_id')).toBe(true);
    expect(remapped.has('corrected_exchange_id')).toBe(true);
    expect(remapped.size).toBeGreaterThan(25);
  });

  it('sees the archived tables in the replayed schema (sanity check on the replay)', () => {
    const missing = [...ARCHIVE_COLLECTED_TABLES].filter((table) => !columns.has(table)).sort();
    expect(missing, 'every archived table must exist in the migrations').toEqual([]);
    expect(jsonColumns.get('phases')?.has('config_json')).toBe(true);
  });

  it('every id-bearing column on an archived table is remapped or consciously not', () => {
    const unhandled: string[] = [];
    for (const table of [...ARCHIVE_COLLECTED_TABLES].sort()) {
      const declaredJsonColumns = jsonColumnsWithDeclaredPaths(table);
      for (const column of [...(columns.get(table) ?? [])].sort()) {
        if (!/_id$|_ids$/.test(column)) continue;
        // A `*_ids` column is usually JSON, and is then handled by a declared
        // path rather than by the FK sweep.
        if (remapped.has(column) || declaredJsonColumns.has(column)) continue;
        if (FK_COLUMNS_NOT_REMAPPED.has(`${table}.${column}`)) continue;
        unhandled.push(`${table}.${column}`);
      }
    }

    expect(
      unhandled,
      `These id columns are on archived tables and nothing remaps them, so a ` +
        `restored copy keeps pointing at the SOURCE event's rows — with the FK ` +
        `satisfied, because those rows still exist. Add each to remapRow, or, if ` +
        `it names something outside the archive (an auth user, an org-level ` +
        `catalogue, an external system), to FK_COLUMNS_NOT_REMAPPED with the ` +
        `reason:\n` +
        unhandled.map((entry) => `  - ${entry}`).join('\n'),
    ).toEqual([]);
  });

  it('every JSON column on an archived table declares its ids or is declared id-free', () => {
    const unbucketed: string[] = [];
    for (const table of [...ARCHIVE_COLLECTED_TABLES].sort()) {
      const declaredJsonColumns = jsonColumnsWithDeclaredPaths(table);
      for (const column of [...(jsonColumns.get(table) ?? [])].sort()) {
        if (declaredJsonColumns.has(column)) continue;
        if (JSON_COLUMNS_WITHOUT_IDS.has(`${table}.${column}`)) continue;
        unbucketed.push(`${table}.${column}`);
      }
    }

    expect(
      unbucketed,
      `These JSON columns are on archived tables and nobody has said whether they ` +
        `hold ids. \`mapFk\` cannot see inside a JSON column, so any id in one ` +
        `survives a restore verbatim. Read what writes the column, then either add ` +
        `its paths to JSON_ID_PATHS or list it in JSON_COLUMNS_WITHOUT_IDS:\n` +
        unbucketed.map((entry) => `  - ${entry}`).join('\n'),
    ).toEqual([]);
  });

  it('the two allowlists name real columns (guards against typos / dead entries)', () => {
    const stale = [...JSON_COLUMNS_WITHOUT_IDS, ...FK_COLUMNS_NOT_REMAPPED]
      .filter((entry) => {
        const [table, column] = entry.split('.') as [string, string];
        return !columns.get(table)?.has(column);
      })
      .sort();
    expect(stale, 'allowlist entries that no migration creates').toEqual([]);
  });
});
