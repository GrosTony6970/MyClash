import assert from 'node:assert/strict';
import test from 'node:test';

import {
  securityDefinerFunctionsReachableByAnon,
  tablesMissingRls,
  viewsMissingSecurityInvoker,
} from './check-db-review.mjs';
import { stripSqlComments } from './lib/sql.mjs';

// Every fixture below is hand-written to fail. None is derived from the real
// migrations: a fixture built from the thing under test cannot falsify it.

// ── Comment stripping ────────────────────────────────────────────────────────

test('a table named in prose is not a declaration', () => {
  // 0184's header quotes `CREATE TABLE IF NOT EXISTS` while explaining the gap
  // it closes. Read literally, that sentence declares a table called "IF".
  const sql = `
    -- The gate only collected tables matching \`CREATE TABLE IF NOT EXISTS\`,
    -- so this table was never checked.
    CREATE TABLE real_table (id uuid PRIMARY KEY);
    ALTER TABLE real_table ENABLE ROW LEVEL SECURITY;
  `;
  assert.deepEqual(tablesMissingRls(stripSqlComments(sql)), []);
  assert.deepEqual(tablesMissingRls(sql), ['IF']);
});

test('block comments are stripped too, and line count is preserved', () => {
  const sql = '/* CREATE TABLE ghost (id uuid);\n   second line */\nCREATE TABLE t (id uuid);';
  const stripped = stripSqlComments(sql);
  assert.equal(stripped.includes('ghost'), false);
  assert.equal(stripped.split('\n').length, sql.split('\n').length);
});

// ── RLS coverage ─────────────────────────────────────────────────────────────

test('catches a table declared without IF NOT EXISTS', () => {
  // The exact shape of 0076_referee_skill_hidden.sql, which shipped
  // world-readable because the old regex required IF NOT EXISTS.
  const sql = `
    CREATE TABLE event_hidden_skills (
      event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      skill_id text NOT NULL
    );
  `;
  assert.deepEqual(tablesMissingRls(sql), ['event_hidden_skills']);
});

test('accepts either declaration style once RLS is enabled', () => {
  const sql = `
    CREATE TABLE a (id uuid);
    CREATE TABLE IF NOT EXISTS b (id uuid);
    create table public.c (id uuid);
    ALTER TABLE a ENABLE ROW LEVEL SECURITY;
    ALTER TABLE b ENABLE ROW LEVEL SECURITY;
    alter table public.c enable row level security;
  `;
  assert.deepEqual(tablesMissingRls(sql), []);
});

// ── View security_invoker ────────────────────────────────────────────────────

test('catches a view that would run as its owner', () => {
  const sql = 'CREATE OR REPLACE VIEW vw_leaky AS SELECT * FROM matches;';
  assert.deepEqual(viewsMissingSecurityInvoker(sql), ['vw_leaky']);
});

test('accepts a view pinned in a later migration than the one that created it', () => {
  // The real shape: created in 0033, pinned in 0184. A file-scoped check would
  // fail this and would have to be silenced.
  const sql = `
    CREATE OR REPLACE VIEW vw_pinned AS SELECT * FROM matches;
    ALTER VIEW vw_pinned SET (security_invoker = on);
  `;
  assert.deepEqual(viewsMissingSecurityInvoker(sql), []);
});

test('accepts security_invoker declared inline at creation', () => {
  const sql = 'CREATE VIEW vw_inline WITH (security_invoker = on) AS SELECT 1;';
  assert.deepEqual(viewsMissingSecurityInvoker(sql), []);
});

test('a CREATE OR REPLACE after the pin resets it', () => {
  // The real shape: pinned in 0184, replaced in 0193 without WITH (...).
  // Postgres replaces the view's options with the (empty) list given, so the
  // view runs as its owner again.
  const sql = `
    CREATE OR REPLACE VIEW vw_replaced AS SELECT * FROM matches;
    ALTER VIEW vw_replaced SET (security_invoker = on);
    CREATE OR REPLACE VIEW vw_replaced AS SELECT *, 1 AS extra FROM matches;
  `;
  assert.deepEqual(viewsMissingSecurityInvoker(sql), ['vw_replaced']);
});

test('a pin after the latest CREATE OR REPLACE holds', () => {
  const sql = `
    CREATE OR REPLACE VIEW vw_repinned AS SELECT * FROM matches;
    ALTER VIEW vw_repinned SET (security_invoker = on);
    CREATE OR REPLACE VIEW vw_repinned AS SELECT *, 1 AS extra FROM matches;
    ALTER VIEW vw_repinned SET (security_invoker = on);
  `;
  assert.deepEqual(viewsMissingSecurityInvoker(sql), []);
});

test('an ALTER VIEW that does not touch security_invoker leaves the pin', () => {
  const sql = `
    CREATE VIEW vw_owned WITH (security_invoker = on) AS SELECT 1;
    ALTER VIEW vw_owned OWNER TO postgres;
  `;
  assert.deepEqual(viewsMissingSecurityInvoker(sql), []);
});

test('switching security_invoker off unpins the view', () => {
  const sql = `
    CREATE VIEW vw_switched WITH (security_invoker = on) AS SELECT 1;
    ALTER VIEW vw_switched SET (security_invoker = off);
  `;
  assert.deepEqual(viewsMissingSecurityInvoker(sql), ['vw_switched']);
});

test('resetting security_invoker unpins the view, IF EXISTS or not', () => {
  const sql = `
    CREATE VIEW vw_reset WITH (security_invoker = on) AS SELECT 1;
    ALTER VIEW vw_reset RESET (security_invoker);
    CREATE VIEW vw_reset_if WITH (security_invoker = on) AS SELECT 1;
    ALTER VIEW IF EXISTS vw_reset_if RESET (security_invoker);
  `;
  assert.deepEqual(viewsMissingSecurityInvoker(sql), ['vw_reset', 'vw_reset_if']);
});

// ── SECURITY DEFINER reachability ────────────────────────────────────────────

test('REVOKE ... FROM public does not count as revoked', () => {
  // 0156's actual pattern. The linter proved anon could still execute it: the
  // image grants EXECUTE to anon by name, and a role-specific grant survives a
  // revoke aimed at PUBLIC.
  const sql = `
    create or replace function public.admin_runtime_db_stats()
    returns jsonb language sql stable security definer
    set search_path = public, pg_catalog
    as $$ select 1 $$;
    revoke all on function public.admin_runtime_db_stats() from public;
    grant execute on function public.admin_runtime_db_stats() to service_role;
  `;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(sql), ['admin_runtime_db_stats']);
});

test('accepts a revoke that names both roles, across a multi-line signature', () => {
  const sql = `
    create or replace function public.record_query_error(
      p_fingerprint text, p_status int
    ) returns void language sql volatile security definer
    set search_path = public, pg_catalog
    as $$ select 1 $$;
    REVOKE EXECUTE ON FUNCTION public.record_query_error(
      text, int
    ) FROM anon, authenticated;
  `;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(sql), []);
});

test('revoking only one of the two roles is not enough', () => {
  const sql = `
    create or replace function public.f() returns void language sql security definer as $$ select 1 $$;
    revoke execute on function public.f() from anon;
  `;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(sql), ['f']);
});

test('a plain function does not inherit the next function SECURITY DEFINER', () => {
  // The scan is bounded at the body marker. Unbounded, `invoker_fn` would be
  // reported because a definer function is declared after it.
  const sql = `
    create or replace function public.invoker_fn() returns void language sql as $$ select 1 $$;
    create or replace function public.definer_fn() returns void language sql security definer as $$ select 1 $$;
    revoke execute on function public.definer_fn() from anon, authenticated;
  `;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(sql), []);
});

// ── The real corpus ──────────────────────────────────────────────────────────

test('the shipped migrations satisfy all three rules', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = join(process.cwd(), 'packages', 'db', 'migrations');
  const sql = stripSqlComments(
    readdirSync(dir)
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort()
      .map((name) => readFileSync(join(dir, name), 'utf8'))
      .join('\n'),
  );
  assert.deepEqual(tablesMissingRls(sql), []);
  assert.deepEqual(viewsMissingSecurityInvoker(sql), []);
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(sql), []);
});
