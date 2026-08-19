import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  collectBindings,
  collectPublished,
  judge,
  scanRoots,
  scanSourcesByRoot,
} from './check-realtime-bindings.mjs';
import { stripSqlComments } from './lib/sql.mjs';
import { toRepoPath } from './lib/repo-scan.mjs';

// A reader over an object literal, so the rule runs with no filesystem. The
// gate calls read(path, 'utf8'); the second argument is ignored here.
const readerFor = (files) => (path) => files[path];
const asIs = (path) => path;

const bind = (table) => `useEffect(() => {
  channel.on('postgres_changes', { event: '*', schema: 'public', table: ${table} }, onChange);
}, []);`;

// ── Collecting bindings ──────────────────────────────────────────────────────

test('a literal table name is collected with the file and line it was bound at', () => {
  const files = { 'a.ts': `const x = 1;\n${bind("'matches'")}` };

  const { boundTables, dynamicBindings } = collectBindings(
    Object.keys(files),
    readerFor(files),
    asIs,
  );

  assert.deepEqual([...boundTables.keys()], ['matches']);
  assert.deepEqual(boundTables.get('matches'), ['a.ts:3']);
  assert.deepEqual(dynamicBindings, []);
});

test('a computed table name is reported, because it cannot be checked', () => {
  const files = { 'a.ts': bind('opts.table') };

  const { boundTables, dynamicBindings } = collectBindings(
    Object.keys(files),
    readerFor(files),
    asIs,
  );

  assert.equal(boundTables.size, 0);
  assert.equal(dynamicBindings.length, 1);
  assert.match(dynamicBindings[0], /^a\.ts:2: table is not a string literal \(opts\.table/);
});

test('the generic hook definitions are exempt by path', () => {
  // Their bodies read `table: opts.table` because the table IS their parameter.
  // Their call sites are what this gate checks.
  const path = 'apps/web-admin/src/lib/supabase-browser.ts';
  const files = { [path]: bind('opts.table') };

  const { dynamicBindings } = collectBindings(Object.keys(files), readerFor(files), asIs);

  assert.deepEqual(dynamicBindings, []);
});

test('useRealtimeWithFallback is an anchor too, not just postgres_changes', () => {
  const files = { 'a.ts': "useRealtimeWithFallback({ table: 'exchanges', pollMs: 30000 });" };

  const { boundTables } = collectBindings(Object.keys(files), readerFor(files), asIs);

  assert.deepEqual([...boundTables.keys()], ['exchanges']);
});

test('every binding in a file is collected, not just the first', () => {
  const files = { 'a.ts': `${bind("'matches'")}\n${bind("'exchanges'")}` };

  const { boundTables } = collectBindings(Object.keys(files), readerFor(files), asIs);

  assert.deepEqual([...boundTables.keys()].sort(), ['exchanges', 'matches']);
});

test('a table bound in two files is reported with both sites', () => {
  const files = { 'a.ts': bind("'matches'"), 'b.ts': `\n${bind("'matches'")}` };

  const { boundTables } = collectBindings(Object.keys(files), readerFor(files), asIs);

  // Per-file labelling, not just a count: the finding has to say WHERE to look.
  assert.deepEqual(boundTables.get('matches'), ['a.ts:2', 'b.ts:3']);
});

test('scanned counts files read, not files that held a binding', () => {
  // This is the number the harness checks for an empty scan, so it has to mean
  // "files this rule examined" — a clean file was examined and found clean.
  const files = { 'a.ts': bind("'matches'"), 'b.ts': 'export const nothing = 1;' };

  const { scanned, boundTables } = collectBindings(Object.keys(files), readerFor(files), asIs);

  assert.equal(scanned, 2);
  assert.equal(boundTables.size, 1);
});

// ── Collecting what the migrations publish ───────────────────────────────────

test('a publication named in prose is not a publication', () => {
  // 0167's own header quotes the statements it explains. Counting prose as DDL
  // would let the gate pass on documentation.
  const sql = `
    /* This migration runs
       ALTER PUBLICATION supabase_realtime ADD TABLE match_penalties;
       to close the gap 0004 left. */
    ALTER PUBLICATION supabase_realtime ADD TABLE matches;
    ALTER TABLE matches REPLICA IDENTITY FULL;
  `;

  const { published, replicaFull } = collectPublished(stripSqlComments(sql));

  assert.deepEqual([...published], ['matches']);
  assert.deepEqual([...replicaFull], ['matches']);
});

// ── Judging ──────────────────────────────────────────────────────────────────

const judgeOne = (table, { published = [], replicaFull = [] } = {}) =>
  judge({
    boundTables: new Map([[table, ['a.ts:1']]]),
    dynamicBindings: [],
    published: new Set(published),
    replicaFull: new Set(replicaFull),
  });

test('a bound table that was never published is a finding', () => {
  const findings = judgeOne('match_penalties');

  assert.equal(findings.length, 1);
  assert.match(findings[0], /never added to the supabase_realtime publication/);
  assert.match(findings[0], /kills the WHOLE channel/);
  assert.match(findings[0], /ADD TABLE match_penalties;/);
});

test('a published table with no REPLICA IDENTITY FULL is a different finding', () => {
  const findings = judgeOne('matches', { published: ['matches'] });

  assert.equal(findings.length, 1);
  assert.match(findings[0], /published but has no REPLICA IDENTITY FULL/);
});

test('a fully backed binding is no finding at all', () => {
  assert.deepEqual(judgeOne('matches', { published: ['matches'], replicaFull: ['matches'] }), []);
});

test('a table published but subscribed by nobody is not a finding', () => {
  const findings = judge({
    boundTables: new Map(),
    dynamicBindings: [],
    published: new Set(['audit_log']),
    replicaFull: new Set(['audit_log']),
  });

  assert.deepEqual(findings, []);
});

// ── Anti-vacuity: the two ways this gate reads green over nothing ────────────

test('every scan root still resolves to files', () => {
  // The harness checks the TOTAL for zero, which only catches all four roots
  // moving at once. `missingRoot: 'empty'` is deliberate — absent and unreadable
  // are different answers — so renaming ONE root leaves the total non-zero and
  // that app silently stops being checked. This is what notices.
  assert.equal(scanRoots.length, 4, 'a scan root was dropped from the list, not just renamed');
  for (const [dir, files] of scanSourcesByRoot()) {
    assert.ok(
      files.length > 0,
      `${toRepoPath(dir)} resolves to no files — the root moved, and the gate reads green over it`,
    );
  }
});

test('the real repo still resolves the bindings it is known to have', () => {
  // scanned counts files READ, so it cannot see a collapsed rule: break one
  // character in the anchor and the count stays at ~1050 while the binding set
  // empties. These four are useLiveMatch's, the ones whose publication gap
  // caused the outage 0167 fixed.
  //
  // Containment, not equality: the walk reads disk rather than git, so an
  // untracked scratch component could legitimately add a fifth binding on a
  // developer's machine. Equality would then be red locally and green in CI.
  const files = [...scanSourcesByRoot().values()].flat();
  const { boundTables, scanned } = collectBindings(files);

  for (const table of ['exchanges', 'match_events', 'match_penalties', 'matches']) {
    assert.ok(boundTables.has(table), `${table} is no longer detected as a realtime binding`);
  }
  assert.ok(scanned > 500, `expected the real client sources, got ${scanned} files`);
});

// ── Registration ─────────────────────────────────────────────────────────────

test('package.json exposes the gate', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));

  assert.equal(
    manifest.scripts?.['db:realtime-bindings'],
    'node scripts/check-realtime-bindings.mjs',
  );
});

test('CI runs the gate as its own step', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');

  assert.ok(ci.includes('pnpm db:realtime-bindings'), 'CI lint job must run the gate');
  // Its own verdict, not chained behind another gate's exit code. Eight gates
  // once sat behind a red `&&` chain for about six weeks without running.
  assert.ok(
    !/&&\s*pnpm db:realtime-bindings/.test(ci),
    'db:realtime-bindings must be its own step, never &&-chained behind another gate',
  );
});

// ── Importing must have no effect ────────────────────────────────────────────

test('importing the gate does not run it', () => {
  // scripts/build-app-bundles.mjs imports a gate on the production path. A
  // module-scope effect here would fail that build with no message.
  assert.equal(process.exitCode, undefined);
});
