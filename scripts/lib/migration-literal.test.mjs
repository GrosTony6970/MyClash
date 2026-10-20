import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MIGRATIONS_DIR, migrationLiteral } from './migration-literal.mjs';

/** A migrations folder holding `files`, each `name: sql`. */
function folder(files) {
  const dir = mkdtempSync(join(tmpdir(), 'myclash-literal-'));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return dir;
}

const line = (value, name = 'start') =>
  `  DEFAULT '${JSON.stringify(value)}'::jsonb -- literal: ${name}\n`;

test('reads the literal one migration tags, as JSON', () => {
  const dir = folder({
    '0001_a.sql': `ALTER TABLE t\n${line({ a: 1 })}`,
    '0002_b.sql': 'SELECT 1;\n',
  });
  assert.deepEqual(migrationLiteral('start', dir), { file: '0001_a.sql', value: { a: 1 } });
});

test('collapses the same value tagged twice in that migration', () => {
  const dir = folder({ '0001_a.sql': line({ a: 1 }) + line({ a: 1 }) });
  assert.deepEqual(migrationLiteral('start', dir).value, { a: 1 });
});

test('refuses two different values under one name', () => {
  const dir = folder({ '0001_a.sql': line({ a: 1 }) + line({ a: 2 }) });
  assert.throws(() => migrationLiteral('start', dir), /2 different values/u);
});

test('refuses a name no migration tags, and one two migrations tag', () => {
  assert.throws(() => migrationLiteral('start', folder({ '0001_a.sql': 'SELECT 1;\n' })), /none/u);
  const two = folder({ '0001_a.sql': line({ a: 1 }), '0002_b.sql': line({ a: 1 }) });
  assert.throws(() => migrationLiteral('start', two), /2 migrations tag it/u);
});

test('reads a name whole: a longer name ending with it is not it', () => {
  const dir = folder({ '0001_a.sql': line({ a: 1 }, 'club_start') + line({ b: 2 }, 'start') });
  assert.deepEqual(migrationLiteral('start', dir).value, { b: 2 });
});

test('refuses a tagged line that holds no jsonb literal', () => {
  const dir = folder({ '0001_a.sql': "  DEFAULT 'x' -- literal: start\n" });
  assert.throws(() => migrationLiteral('start', dir), /holds no jsonb/u);
});

test('finds the real migrations from its own place, whatever the working directory', () => {
  assert.equal(migrationLiteral('ffamhe_forfeit_rules', MIGRATIONS_DIR).value.disqualifyAfter, 2);
});
