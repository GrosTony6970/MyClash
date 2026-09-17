import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildMigrationSchema,
  findMigrationsDir,
  normaliseTable,
} from './testing/migration-schema';

/**
 * Every INSERT in the Phase 4 synthetic perf fixture names only a table and
 * columns the migrations leave in place.
 *
 * `db:perf:fixture` compares the committed SQL with its generator, which proves
 * the two agree and says nothing about the schema, and nothing in CI applies the
 * SQL to a database. So the file sat on four dropped columns
 * (`events.location`, `tournaments.category`, and `user_id` on both referee
 * tables) and `db:perf:explain` had nothing it could load. This reads each
 * INSERT's column list against the replayed schema, offline. It went red, as
 * meant, when 0198 dropped `referee_assignments.starts_at` and `ends_at` while
 * the fixture still wrote them.
 *
 * It checks INSERT lists only: not the columns a DELETE or SELECT in the file
 * reads, not `phase4_explain.sql`, and not rows. A CHECK or a foreign key the
 * rows break shows only when the file is applied to a replayed database.
 */
const FIXTURE = path.resolve(findMigrationsDir(), '../fixtures/phase4_synthetic.sql');
const fixture = readFileSync(FIXTURE, 'utf8');

/** `INSERT INTO table (a, b, c)`. The column list may span lines. */
const INSERT = /INSERT\s+INTO\s+([\w.]+)\s*\(([^)]*)\)/gi;

const inserts = [...fixture.matchAll(INSERT)].map(([, table, columns]) => ({
  table: normaliseTable(table ?? ''),
  columns: (columns ?? '').split(',').map((column) => column.trim().toLowerCase()),
}));

describe('the Phase 4 perf fixture', () => {
  const schema = buildMigrationSchema();

  it('reads every INSERT the file holds', () => {
    // A statement the pattern cannot read (no column list, a quoted name) would
    // otherwise pass the two checks below unseen.
    const statements = fixture.match(/\bINSERT\s+INTO\b/gi) ?? [];
    expect(statements.length).toBeGreaterThanOrEqual(20);
    expect(inserts).toHaveLength(statements.length);
  });

  it('inserts into no table the migrations do not create', () => {
    const unknown = inserts.map(({ table }) => table).filter((table) => !schema.columns.has(table));
    expect(unknown).toEqual([]);
  });

  it('writes no column the migrations do not leave in place', () => {
    const unknown = inserts.flatMap(({ table, columns }) =>
      columns
        .filter((column) => !schema.columns.get(table)?.has(column))
        .map((column) => `${table}.${column}`),
    );
    expect(unknown, 'the fixture will not apply to a replayed database').toEqual([]);
  });
});
