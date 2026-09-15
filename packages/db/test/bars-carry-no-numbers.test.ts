/**
 * The bars carry no numbers (ADR-018, migration 0196).
 *
 * A programme bar used to hold its own bout length, gap and rest, next to the
 * Event's planner sheet that holds the same three. The sheet is now the one
 * place they are typed, so the bar's columns are dropped, and a Match gains a
 * single nullable override that must be above zero when set.
 *
 * This test reads the migrations in order and asserts the FINAL declared
 * action on each column, so a later migration cannot quietly add a bar's
 * length back or drop the override. It cannot see the running database;
 * `pnpm db:migrations:replay` and a read of `pg_constraint` cover that.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const migrationsDir = join(__dirname, '..', 'migrations');

const BAR_COLUMNS = ['match_duration_minutes', 'match_gap_seconds', 'min_rest_minutes'] as const;
const OVERRIDE = 'planned_duration_override_minutes';

function migrationsInOrder(): Array<{ file: string; sql: string }> {
  return readdirSync(migrationsDir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(migrationsDir, file), 'utf8') }));
}

/** SQL with `--` comments removed, so prose naming a column is not read as DDL. */
function withoutComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

type ColumnAction = { action: 'ADD' | 'DROP'; file: string; declaration: string };

/**
 * The last thing any migration does to a column: declare it or drop it, where,
 * and for a declaration, what follows its type up to the next comma or semicolon.
 */
function finalAction(column: string): ColumnAction | null {
  // Inline in a CREATE TABLE (`match_gap_seconds INTEGER …`) or through
  // `ADD COLUMN IF NOT EXISTS min_rest_minutes INTEGER`, as any integer type.
  const declared = new RegExp(
    `\\b${column}\\s+(?:INTEGER|INT|SMALLINT|BIGINT|NUMERIC)\\b([^,;]*)`,
    'gi',
  );
  const dropped = new RegExp(`DROP\\s+COLUMN\\s+(?:IF\\s+EXISTS\\s+)?${column}\\b`, 'gi');

  let latest: ColumnAction | null = null;
  for (const { file, sql } of migrationsInOrder()) {
    const body = withoutComments(sql);
    // Within one file, whichever statement comes later wins.
    const hits = [
      ...[...body.matchAll(declared)].map((hit) => ({
        action: 'ADD' as const,
        at: hit.index,
        declaration: hit[1] ?? '',
      })),
      ...[...body.matchAll(dropped)].map((hit) => ({
        action: 'DROP' as const,
        at: hit.index,
        declaration: '',
      })),
    ].sort((a, b) => a.at - b.at);
    const last = hits.at(-1);
    if (last) latest = { action: last.action, file, declaration: last.declaration };
  }
  return latest;
}

describe('event_programme_blocks carries no bout numbers', () => {
  it.each(BAR_COLUMNS)('%s ends up dropped', (column) => {
    const final = finalAction(column);
    expect(final, `no migration declares event_programme_blocks.${column}`).not.toBeNull();
    expect(
      final?.action,
      `event_programme_blocks.${column} is ${final?.action === 'ADD' ? 'declared' : 'dropped'} last by ` +
        `${final?.file}. The planner sheet is the one place a bout length, gap or rest is typed (ADR-018).`,
    ).toBe('DROP');
  });
});

describe('matches.planned_duration_override_minutes', () => {
  const allSql = migrationsInOrder()
    .map((m) => withoutComments(m.sql))
    .join('\n');

  it('is added to matches', () => {
    expect(allSql).toMatch(
      new RegExp(
        `ALTER\\s+TABLE\\s+matches\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${OVERRIDE}\\b`,
        'i',
      ),
    );
  });

  it('ends up declared as a nullable integer with no default', () => {
    // A default would mint the length ADR-017 forbids; NOT NULL would force one.
    const final = finalAction(OVERRIDE);
    expect(final?.action, `matches.${OVERRIDE} is dropped last by ${final?.file}`).toBe('ADD');
    expect(final?.declaration).not.toMatch(/NOT\s+NULL|DEFAULT/i);
  });

  it('is above zero when set, under a named constraint', () => {
    expect(allSql).toMatch(
      /ADD\s+CONSTRAINT\s+matches_planned_duration_override_positive\s+CHECK\s*\(\s*planned_duration_override_minutes\s+IS\s+NULL\s+OR\s+planned_duration_override_minutes\s*>\s*0\s*\)/i,
    );
  });
});
