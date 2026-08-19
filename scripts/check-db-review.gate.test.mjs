/**
 * The rules this gate holds that scripts/check-db-review.test.mjs does not.
 *
 * That file covers three rules — RLS coverage, view security_invoker and
 * SECURITY DEFINER reachability — and is left byte-identical as the regression
 * proof for the harness conversion. The gate holds about twenty. Splitting its
 * body into named functions could have dropped any of the other seventeen with
 * every gate in the fleet still reading green, so each one gets a fixture here.
 *
 * Fixtures are hand-written to fail. None is derived from the real migrations:
 * a fixture built from the thing under test cannot falsify it.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  checkConstraintHygiene,
  checkFixtureSchema,
  checkForeignKeyIndexes,
  checkIdempotency,
  checkMigrationOrdering,
  checkProductionRunner,
  checkRenamedReferences,
  checkRequiredArtifacts,
  checkRequiredHelpers,
  checkSchemaSecurity,
  checkUnappliedSqlFiles,
  gate,
  loadMigrationCorpus,
} from './check-db-review.mjs';
import { objectName } from './lib/db-rules.mjs';

const messages = (findings) => findings.map((f) => (typeof f === 'string' ? f : f.message));
const levels = (findings) => findings.map((f) => (typeof f === 'string' ? 'error' : f.level));

function dirWith(names) {
  const dir = mkdtempSync(join(tmpdir(), 'myclash-db-review-'));
  for (const name of names) writeFileSync(join(dir, name), '-- fixture\n');
  return dir;
}

// ── The corpus floor ─────────────────────────────────────────────────────────

test('a .sql the runner will never apply is an error, not a silent skip', () => {
  // The corpus is a readdir plus a regex with no floor. These four names are
  // skipped in silence by migrate.mjs and by this gate, so a CREATE TABLE
  // inside one ships without anyone checking it for RLS.
  const dir = dirWith(['0001_real.sql', '186_short.sql', '0187-dashed.sql', 'rollback.sql']);

  const findings = checkUnappliedSqlFiles(dir);

  assert.equal(findings.length, 3);
  assert.ok(findings.every((f) => /never applies it and this gate never reviews it/.test(f)));
  assert.ok(findings.every((f) => /Rename it to NNNN_name\.sql/.test(f)));
});

test('a numbered corpus, with or without a .gitkeep, produces no such finding', () => {
  // packages/db/migrations holds a .gitkeep. It is not a migration and is not
  // pretending to be one.
  assert.deepEqual(checkUnappliedSqlFiles(dirWith(['0001_a.sql', '0002_b.sql'])), []);
  assert.deepEqual(checkUnappliedSqlFiles(dirWith(['0001_a.sql', '.gitkeep'])), []);
});

test('the real migrations directory holds no unappliable .sql', () => {
  assert.deepEqual(checkUnappliedSqlFiles(), []);
});

// ── Ordering ─────────────────────────────────────────────────────────────────

test('a reused prefix is a blocker', () => {
  // 0102 was claimed twice and db:review sat red for a month.
  const findings = checkMigrationOrdering(['0101_a.sql', '0102_b.sql', '0102_c.sql']);

  assert.ok(messages(findings).some((m) => m === 'Duplicate migration prefixes: 102'));
});

test('prefixes must strictly ascend', () => {
  const findings = checkMigrationOrdering(['0002_b.sql', '0001_a.sql']);

  assert.deepEqual(messages(findings), [
    'Migration ordering is not strictly ascending around 0002_b.sql / 0001_a.sql',
  ]);
  assert.deepEqual(checkMigrationOrdering(['0001_a.sql', '0002_b.sql', '0020_c.sql']), []);
});

// ── Schema security ──────────────────────────────────────────────────────────

test('the three schema-security rules all reach the report', () => {
  const sql = `
    CREATE TABLE leaky (id uuid);
    CREATE OR REPLACE VIEW vw_leaky AS SELECT 1;
    CREATE OR REPLACE FUNCTION public.f() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
  `;

  const findings = messages(checkSchemaSecurity(sql));

  assert.equal(findings.length, 3);
  assert.match(findings[0], /Tables without ENABLE ROW LEVEL SECURITY: leaky/);
  assert.match(findings[1], /Views without security_invoker = on.*vw_leaky/);
  assert.match(findings[2], /SECURITY DEFINER functions must REVOKE EXECUTE.*: f$/);
  const guarded = 'CREATE TABLE t (id uuid);\nALTER TABLE t ENABLE ROW LEVEL SECURITY;';
  assert.deepEqual(checkSchemaSecurity(guarded), []);
});

// ── Idempotency (warnings, not blockers) ─────────────────────────────────────

test('a table or index without IF NOT EXISTS is a warning, not a blocker', () => {
  // The distinction is load-bearing: a warning still exits 0. Reported as an
  // error, replay hygiene would block every push.
  const sql = 'CREATE TABLE t (id uuid);\nCREATE INDEX t_idx ON t (id);';

  const findings = checkIdempotency(sql);

  assert.deepEqual(levels(findings), ['warn', 'warn']);
  assert.match(messages(findings)[0], /Existing tables without IF NOT EXISTS.*: t$/);
  assert.match(messages(findings)[1], /Existing indexes without IF NOT EXISTS.*: t_idx$/);
  assert.deepEqual(
    checkIdempotency(
      'CREATE TABLE IF NOT EXISTS t (id uuid);\nCREATE INDEX IF NOT EXISTS i ON t (id);',
    ),
    [],
  );
});

// ── Constraint and index hygiene ─────────────────────────────────────────────

test('an inline UNIQUE holding an expression is a blocker', () => {
  const sql = '  UNIQUE (lower(name), event_id)';

  const findings = messages(checkConstraintHygiene(sql));

  assert.equal(findings.length, 1);
  assert.match(findings[0], /Inline UNIQUE constraints must not contain expressions/);
  assert.deepEqual(checkConstraintHygiene('  UNIQUE (event_id, person_id)'), []);
});

test('a raw unaccent() in an index expression is a blocker', () => {
  // unaccent() is not IMMUTABLE, so the index cannot be built; the wrapper is.
  const findings = messages(checkConstraintHygiene('CREATE INDEX x ON clubs (unaccent(name));\n'));

  assert.equal(findings.length, 1);
  assert.match(findings[0], /must use public\.immutable_unaccent\(\.\.\.\), not raw unaccent/);
  assert.deepEqual(
    checkConstraintHygiene('CREATE INDEX x ON clubs (public.immutable_unaccent(name));\n'),
    [],
  );
});

// ── Required extensions and helpers ──────────────────────────────────────────

const helpersSql = `
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE EXTENSION IF NOT EXISTS unaccent;
  CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
  CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb AS $$ SELECT '{}'::jsonb $$;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$ SELECT NULL::uuid $$;
  CREATE OR REPLACE FUNCTION public.immutable_unaccent(TEXT) RETURNS text AS $$ SELECT $1 $$;
`;

test('a complete set of extensions and helpers is clean', () => {
  assert.deepEqual(checkRequiredHelpers(helpersSql), []);
});

test('each missing extension and helper is named', () => {
  const findings = messages(checkRequiredHelpers(''));

  assert.deepEqual(findings, [
    'Missing required extension migration: uuid-ossp',
    'Missing required extension migration: pg_trgm',
    'Missing required extension migration: unaccent',
    'Missing required extension migration: pg_stat_statements',
    'Missing self-hosted Supabase compatibility helper: auth.jwt().',
    'Missing self-hosted Supabase compatibility helper: auth.uid().',
    'Missing public.immutable_unaccent(TEXT) helper for indexed unaccent expressions.',
  ]);
});

test('dropping one helper leaves the other six passing', () => {
  const sql = helpersSql.replace('CREATE EXTENSION IF NOT EXISTS pg_trgm;', '');

  assert.deepEqual(messages(checkRequiredHelpers(sql)), [
    'Missing required extension migration: pg_trgm',
  ]);
});

// ── Renamed objects ──────────────────────────────────────────────────────────

const renamed = (file, sql) => checkRenamedReferences([file], new Map([[file, sql]]));

test('a migration after 0023 may not treat fighters as a table', () => {
  const findings = messages(renamed('0100_x.sql', 'SELECT * FROM fighters;'));

  assert.equal(findings.length, 1);
  assert.match(findings[0], /references fighters as a table after 0023_global_persons\.sql/);
});

test('a migration before 0023 still may', () => {
  assert.deepEqual(renamed('0010_x.sql', 'SELECT * FROM fighters;'), []);
});

test('fighters named only in a comment is not a reference', () => {
  assert.deepEqual(renamed('0100_x.sql', '-- SELECT * FROM fighters;\nSELECT 1;'), []);
});

test('a migration after 0185 may not reintroduce fighter_id on a league table', () => {
  const findings = messages(
    renamed('0200_x.sql', 'ALTER TABLE league_rankings ADD COLUMN fighter_id uuid;'),
  );

  assert.equal(findings.length, 1);
  assert.match(findings[0], /names fighter_id on a league table; 0185 renamed it/);
});

test('the renamed column itself is accepted', () => {
  const sql = 'ALTER TABLE league_rankings ADD COLUMN global_person_id uuid;';
  assert.deepEqual(renamed('0200_x.sql', sql), []);
});

test('0026 must drop find_club_by_name before changing its return shape', () => {
  const file = '0026_club_lookup_with_abv.sql';
  const body =
    'CREATE OR REPLACE FUNCTION find_club_by_name(search_name TEXT, threshold FLOAT) RETURNS TABLE (id uuid) AS $$ SELECT 1 $$;';

  assert.match(
    messages(renamed(file, body))[0],
    /must drop find_club_by_name\(TEXT, FLOAT\) before changing its return table shape/,
  );
  assert.deepEqual(
    renamed(file, `DROP FUNCTION IF EXISTS find_club_by_name(TEXT, FLOAT);\n${body}`),
    [],
  );
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

test('a fixture still writing to the renamed fighters table is a blocker', () => {
  const read = () => 'DELETE FROM fighters;';

  const findings = messages(checkFixtureSchema(['f.sql'], read));

  assert.deepEqual(findings, ['f.sql must use global_persons, not the renamed fighters table.']);
});

test('a fixture naming global_fighter_id is a blocker', () => {
  const findings = messages(checkFixtureSchema(['f.sql'], () => 'SELECT global_fighter_id;'));

  assert.deepEqual(findings, ['f.sql must use persons.global_person_id, not global_fighter_id.']);
});

test('the shipped fixtures are clean', () => {
  assert.deepEqual(checkFixtureSchema(), []);
});

// ── The production runner ────────────────────────────────────────────────────

const runnerScript = `
  import postgres from 'postgres';
  function handleNotice({ code, message }) { console.warn(\`Notice\${code}: \${message}\`); }
  const sql = postgres({ onnotice: handleNotice });
  // myclash_schema_migrations checksum_sha256 pg_advisory_lock pg_advisory_unlock
  // 'already exists, skipping' 'does not exist, skipping'
  // 'Suppressed \${suppressedNoticeCount} expected PostgreSQL notices.'
`;

test('a runner meeting every requirement is clean', () => {
  assert.deepEqual(checkProductionRunner(runnerScript, 'const q = "phases(id)";'), []);
});

test('a runner missing the advisory lock is named', () => {
  const findings = messages(
    checkProductionRunner(runnerScript.replace('pg_advisory_lock', ''), ''),
  );

  assert.deepEqual(findings, ['Production migration script is missing pg_advisory_lock.']);
});

test('dumping raw notices with console.log is a blocker', () => {
  const script = runnerScript.replace('onnotice: handleNotice', 'onnotice: console.log');

  const findings = messages(checkProductionRunner(script, ''));

  assert.ok(findings.includes('Production migration script is missing onnotice: handleNotice.'));
  assert.ok(
    findings.includes(
      'Production migration script must not dump raw PostgreSQL notices with console.log.',
    ),
  );
});

test('a Drizzle migrator import is a blocker', () => {
  const script = `import { migrate } from 'drizzle-orm/postgres-js/migrator';\n${runnerScript}`;

  assert.ok(
    messages(checkProductionRunner(script, '')).includes(
      'Production migration script must not use Drizzle migrator metadata.',
    ),
  );
});

test('the nested phases(...matches(...)) embed is a blocker', () => {
  const findings = messages(
    checkProductionRunner(runnerScript, '.select("phases(id, matches(id))")'),
  );

  assert.deepEqual(findings, [
    'MatchAutoLockService must not rely on a nested phases(...matches(...)) PostgREST embed; matches.phase_id is not exposed as a schema-cache relationship.',
  ]);
});

test('the shipped runner and service are clean', () => {
  assert.deepEqual(checkProductionRunner(), []);
});

// ── Foreign-key indexes (a warning) ──────────────────────────────────────────

test('an unindexed foreign-key column is a warning', () => {
  const sql = '\n  club_id UUID NOT NULL REFERENCES clubs(id)\n';

  const findings = checkForeignKeyIndexes(sql);

  assert.deepEqual(levels(findings), ['warn']);
  assert.match(
    messages(findings)[0],
    /Foreign-key column names needing manual index review: club_id/,
  );
});

test('an indexed foreign-key column is silent', () => {
  const sql = '\n  club_id UUID NOT NULL REFERENCES clubs(id)\nCREATE INDEX i ON t (club_id);';
  assert.deepEqual(checkForeignKeyIndexes(sql), []);
});

// ── Required artifacts ───────────────────────────────────────────────────────

test('a missing Phase 4 artifact is named', () => {
  const findings = checkRequiredArtifacts(['docs/THIS_DOES_NOT_EXIST.md']);

  assert.deepEqual(findings, ['Missing required Phase 4 artifact: docs/THIS_DOES_NOT_EXIST.md']);
});

test('every shipped artifact is present', () => {
  assert.deepEqual(checkRequiredArtifacts(), []);
});

// ── Shared helper ────────────────────────────────────────────────────────────

test('a schema-qualified and a quoted name are the same object', () => {
  assert.equal(objectName('public."events"'), 'events');
  assert.equal(objectName('events'), 'events');
});

// ── The gate as a whole ──────────────────────────────────────────────────────

test('the gate reviews the real corpus and reports what it read', () => {
  // The count is the floor: a filter that silently skips files still prints
  // success, just with a smaller N that nobody is checking against.
  const result = gate.run({ argv: [] });

  assert.ok(result.scanned >= 150, `expected the real migration corpus, got ${result.scanned}`);
  assert.equal(result.scanned, loadMigrationCorpus().files.length);
  assert.match(result.summary, /^Reviewed \d+ migrations and \d+ table declarations/);
});

test('the shipped repo raises no blocker, only advisory warnings', () => {
  const result = gate.run({ argv: [] });

  assert.deepEqual(messages(result.findings.filter((f) => typeof f === 'string')), []);
  assert.ok(result.findings.length > 0, 'the advisory warnings are expected to still be reported');
});

// ── Registration ─────────────────────────────────────────────────────────────

test('package.json exposes the gate', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));

  assert.equal(manifest.scripts?.['db:review'], 'node scripts/check-db-review.mjs');
});

test('CI runs the gate as its own step', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');

  assert.ok(ci.includes('pnpm db:review'), 'CI lint job must run pnpm db:review');
  assert.ok(
    !/&&\s*pnpm db:review/.test(ci),
    'db:review must be its own step, never &&-chained behind another gate',
  );
});

test('importing the gate does not run it', () => {
  assert.equal(process.exitCode, undefined);
});
