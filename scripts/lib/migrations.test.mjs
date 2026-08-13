import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MIGRATION_FILE_PATTERN, listMigrationFiles } from './migrations.mjs';

const root = process.cwd();

function fixtureDir(names) {
  const dir = mkdtempSync(join(tmpdir(), 'myclash-migrations-'));
  for (const name of names) writeFileSync(join(dir, name), '-- fixture\n');
  return dir;
}

test('orders by the four-digit prefix, not by string length', () => {
  const dir = fixtureDir(['0002_b.sql', '0181_c.sql', '0001_a.sql', '0020_d.sql']);
  assert.deepEqual(listMigrationFiles(dir), [
    '0001_a.sql',
    '0002_b.sql',
    '0020_d.sql',
    '0181_c.sql',
  ]);
});

test('skips everything that is not a numbered migration', () => {
  const dir = fixtureDir([
    '0001_real.sql',
    'README.md',
    'rollback.sql',
    '001_too_short.sql',
    '00123_too_long.sql',
    '0002_real.sql',
  ]);
  assert.deepEqual(listMigrationFiles(dir), ['0001_real.sql', '0002_real.sql']);
});

test('requires the underscore separator and the .sql extension', () => {
  assert.equal(MIGRATION_FILE_PATTERN.test('0001_add_table.sql'), true);
  assert.equal(MIGRATION_FILE_PATTERN.test('0001-add-table.sql'), false);
  assert.equal(MIGRATION_FILE_PATTERN.test('0001_add_table.sql.bak'), false);
  assert.equal(MIGRATION_FILE_PATTERN.test('0001_.sql'), false);
});

test('the production runner still spells the contract the same way', () => {
  // packages/db/scripts/migrate.mjs is copied into the API image, so it cannot
  // import this module. If its filter is ever edited, the gates that scan the
  // corpus would silently disagree with the runner that applies it — including
  // replay-db-migrations.mjs, which prints success for whatever subset it got.
  const runner = readFileSync(join(root, 'packages', 'db', 'scripts', 'migrate.mjs'), 'utf8');
  assert.ok(
    runner.includes(MIGRATION_FILE_PATTERN.source),
    `packages/db/scripts/migrate.mjs no longer filters on ${MIGRATION_FILE_PATTERN.source} — ` +
      'reconcile it with scripts/lib/migrations.mjs before changing either.',
  );
});

test('the real corpus is non-empty and every entry is ordered', () => {
  // Anti-vacuity: the assertions above all pass against an empty directory.
  const files = listMigrationFiles(join(root, 'packages', 'db', 'migrations'));
  assert.ok(files.length > 100, `expected the real migration corpus, got ${files.length} files`);
  assert.deepEqual(files, [...files].sort());
});
