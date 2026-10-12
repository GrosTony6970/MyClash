/**
 * A bout says when it was last put back in play (migration 0222).
 *
 * The API refuses a press a tablet sends late when the press was made before
 * that time. The column is nullable with no default: a bout never put back in
 * play refuses nothing, and a default would refuse every press made before the
 * row was written.
 *
 * This test reads the migrations in order and asserts the FINAL declared
 * action on the column, so a later migration cannot quietly drop it or give it
 * a default. It cannot see the running database; `pnpm db:migrations:replay`
 * covers that.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const migrationsDir = join(__dirname, '..', 'migrations');
const COLUMN = 'back_in_play_at';

/** Every migration in order, with `--` comments removed: prose that names the column is not DDL. */
function migrationsInOrder(): Array<{ file: string; sql: string }> {
  return readdirSync(migrationsDir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()
    .map((file) => ({
      file,
      sql: readFileSync(join(migrationsDir, file), 'utf8').replace(/--[^\n]*/g, ''),
    }));
}

/** The last thing any migration does to the column, and what follows its type. */
function finalAction(): { action: 'ADD' | 'DROP'; file: string; declaration: string } | null {
  const declared = new RegExp(`\\b${COLUMN}\\s+TIMESTAMPTZ\\b([^,;]*)`, 'gi');
  const dropped = new RegExp(`DROP\\s+COLUMN\\s+(?:IF\\s+EXISTS\\s+)?${COLUMN}\\b`, 'gi');
  let latest: ReturnType<typeof finalAction> = null;
  for (const { file, sql } of migrationsInOrder()) {
    const hits = [
      ...[...sql.matchAll(declared)].map((hit) => ({
        action: 'ADD' as const,
        at: hit.index,
        declaration: hit[1] ?? '',
      })),
      ...[...sql.matchAll(dropped)].map((hit) => ({
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

describe('matches.back_in_play_at', () => {
  it('is added to matches', () => {
    const allSql = migrationsInOrder()
      .map((migration) => migration.sql)
      .join('\n');

    expect(allSql).toMatch(
      new RegExp(
        `ALTER\\s+TABLE\\s+matches\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${COLUMN}\\s+TIMESTAMPTZ\\b`,
        'i',
      ),
    );
  });

  it('ends up declared nullable, with no default', () => {
    const final = finalAction();

    expect(final?.action, `matches.${COLUMN} is dropped last by ${final?.file}`).toBe('ADD');
    expect(final?.declaration).not.toMatch(/NOT\s+NULL|DEFAULT/i);
  });
});
