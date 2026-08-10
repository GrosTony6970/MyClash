/**
 * A polymorphic scope column cannot be both "NOT NULL when this scope is
 * selected" and "SET NULL when its target is deleted".
 *
 * `referee_assignments` carried exactly that contradiction for years: the three
 * scope FKs were declared ON DELETE SET NULL in 0001, and 0091 later added
 * `referee_assignments_scope_check` requiring each to be NOT NULL for its own
 * `scope_type`. Postgres runs a referential SET NULL as a real UPDATE and
 * validates CHECK constraints on it, so deleting a refereed match, pool or
 * piste did not orphan a row — it ABORTED:
 *
 *   ERROR: new row for relation "referee_assignments" violates check
 *          constraint "referee_assignments_scope_check"
 *   CONTEXT: SQL statement "UPDATE ONLY "public"."referee_assignments"
 *            SET "match_id" = NULL WHERE ..."
 *
 * Eight of the nine API delete paths hit it. Migration 0179 makes all three
 * CASCADE, the one action that agrees with the CHECK.
 *
 * This test reads the migrations in order and asserts the FINAL declared
 * action, so a later migration cannot quietly put SET NULL back. It cannot see
 * the running database — the migration's own DO $$ guard covers that on every
 * replay and deploy.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const migrationsDir = join(__dirname, '..', 'migrations');

const SCOPE_COLUMNS = ['match_id', 'pool_id', 'lice_id'] as const;

function migrationsInOrder(): Array<{ file: string; sql: string }> {
  return readdirSync(migrationsDir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(migrationsDir, file), 'utf8') }));
}

/** The last delete action any migration declares for this scope FK. */
function finalDeleteAction(column: string): { action: string; file: string } | null {
  const named = new RegExp(
    `ADD\\s+CONSTRAINT\\s+referee_assignments_${column}_fkey[\\s\\S]*?ON\\s+DELETE\\s+(CASCADE|SET\\s+NULL|RESTRICT|NO\\s+ACTION)`,
    'gi',
  );
  // 0001 declares them inline in CREATE TABLE, with no constraint name.
  const inline = new RegExp(
    `${column}\\s+UUID\\s+REFERENCES\\s+\\w+\\s*\\(id\\)\\s*ON\\s+DELETE\\s+(CASCADE|SET\\s+NULL|RESTRICT|NO\\s+ACTION)`,
    'gi',
  );

  let latest: { action: string; file: string } | null = null;
  for (const { file, sql } of migrationsInOrder()) {
    const scoped = file === '0001_init.sql' ? sql.slice(sql.indexOf('referee_assignments')) : sql;
    for (const pattern of [named, inline]) {
      pattern.lastIndex = 0;
      for (const hit of scoped.matchAll(pattern)) {
        latest = { action: hit[1]!.replace(/\s+/g, ' ').toUpperCase(), file };
      }
    }
  }
  return latest;
}

describe('referee_assignments scope FKs', () => {
  it.each(SCOPE_COLUMNS)('%s ends up ON DELETE CASCADE, never SET NULL', (column) => {
    const final = finalDeleteAction(column);
    expect(final, `no FK declaration found for referee_assignments.${column}`).not.toBeNull();
    expect(
      final?.action,
      `referee_assignments.${column} is ${final?.action} as of ${final?.file}. ` +
        `SET NULL contradicts referee_assignments_scope_check and ABORTS every delete ` +
        `of a refereed ${column.replace('_id', '')} — see migration 0179.`,
    ).toBe('CASCADE');
  });

  it('still requires each scope column to be NOT NULL for its own scope_type', () => {
    // The other half of the pair. If this CHECK is ever dropped, the CASCADE
    // above stops being load-bearing and this test stops meaning anything —
    // so it is asserted rather than assumed.
    const allSql = migrationsInOrder()
      .map((m) => m.sql)
      .join('\n');
    expect(allSql).toContain('referee_assignments_scope_check');
    for (const column of SCOPE_COLUMNS) {
      // `\s+`, not a single space: 0091 column-aligns the three OR branches.
      expect(allSql).toMatch(new RegExp(`${column}\\s+IS NOT NULL`));
    }
  });
});
