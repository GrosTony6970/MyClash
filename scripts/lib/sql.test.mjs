import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { stripSqlComments } from './sql.mjs';

const root = process.cwd();

/** The publication scan in check-realtime-bindings.mjs, applied to some SQL. */
function publishedTables(sql) {
  return [...sql.matchAll(/ALTER\s+PUBLICATION\s+supabase_realtime\s+ADD\s+TABLE\s+(\w+)/gi)].map(
    (match) => match[1].toLowerCase(),
  );
}

test('a publication named inside a block comment is not a publication', () => {
  // The defect this module closes. A migration header that explains the
  // statement it is about to write — or that documents one it decided against
  // — used to register as a real publication in check-realtime-bindings.mjs.
  const sql = `
    /*
     * Realtime: exchanges is already published, so this migration does NOT run
     *   ALTER PUBLICATION supabase_realtime ADD TABLE ghost;
     * again. See 0167.
     */
    ALTER PUBLICATION supabase_realtime ADD TABLE matches;
  `;

  assert.deepEqual(publishedTables(stripSqlComments(sql)), ['matches']);

  // Falsifies the fix: the one-liner check-realtime-bindings.mjs used to carry
  // strips line comments only, and still sees the phantom table.
  const lineCommentsOnly = sql.replace(/--[^\n]*/g, '');
  assert.deepEqual(publishedTables(lineCommentsOnly), ['ghost', 'matches']);
});

test('a publication named in a line comment is not a publication', () => {
  const sql = [
    '-- ALTER PUBLICATION supabase_realtime ADD TABLE ghost;',
    'ALTER PUBLICATION supabase_realtime ADD TABLE matches;',
  ].join('\n');
  assert.deepEqual(publishedTables(stripSqlComments(sql)), ['matches']);
});

test('a table named in prose is not a declaration', () => {
  const sql = '-- CREATE TABLE IF NOT EXISTS foo\nCREATE TABLE real_table (id uuid);';
  const stripped = stripSqlComments(sql);
  assert.equal(/CREATE TABLE IF NOT EXISTS/.test(stripped), false);
  assert.match(stripped, /CREATE TABLE real_table/);
});

test('blanking preserves line numbers and byte offsets', () => {
  const sql = '/* one\n   two */\nCREATE TABLE t (id uuid);';
  const stripped = stripSqlComments(sql);
  assert.equal(stripped.length, sql.length);
  assert.equal(stripped.split('\n').length, sql.split('\n').length);
  assert.equal(stripped.indexOf('CREATE TABLE'), sql.indexOf('CREATE TABLE'));
});

test('statements are left untouched', () => {
  const sql = "INSERT INTO t (note) VALUES ('a plain value');";
  assert.equal(stripSqlComments(sql), sql);
});

test('both SQL gates read the corpus through this stripper', () => {
  // Neither gate may reintroduce a private stripper: that is exactly how the
  // two diverged, with one hardened after a real false-green and the other
  // left on the line-comment-only one-liner.
  for (const gate of ['check-db-review.mjs', 'check-realtime-bindings.mjs']) {
    const source = readFileSync(join(root, 'scripts', gate), 'utf8');
    assert.match(source, /stripSqlComments/, `${gate} must strip comments`);
    assert.doesNotMatch(
      source,
      /\.replace\(\/--\[\^\\n\]\*\/g/,
      `${gate} must not hand-roll comment stripping`,
    );
  }
});
