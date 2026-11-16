/**
 * The SECURITY DEFINER rule of db:review (./definer-rule.mjs, ruling 826): a definer must be closed
 * to PUBLIC and to anon and authenticated by name, read in order statement by statement. The rule
 * over the real corpus is tested in scripts/check-db-review.test.mjs, beside the other two rules.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { securityDefinerFunctionsReachableByAnon } from './definer-rule.mjs';

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

test('a revoke from both roles by name, without PUBLIC, is not enough (ruling 826)', () => {
  // Before 0275 every new function gave PUBLIC EXECUTE, and anon is a member of PUBLIC.
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
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(sql), ['record_query_error']);
});

test('accepts PUBLIC and both roles, across a multi-line signature', () => {
  const sql = `
    create or replace function public.record_query_error(
      p_fingerprint text, p_status int
    ) returns void language sql volatile security definer
    set search_path = public, pg_catalog
    as $$ select 1 $$;
    REVOKE EXECUTE ON FUNCTION public.record_query_error(
      text, int
    ) FROM public, anon, authenticated;
  `;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(sql), []);
});

test('accepts the revokes split across statements and migrations (0182 + 0184)', () => {
  const sql = `
    create or replace function public.record_device_sync_report(a uuid, b text)
    returns void language sql security definer as $$ select 1 $$;
    revoke all on function public.record_device_sync_report(uuid, text) from public;
    revoke execute on function public.record_device_sync_report(uuid, text) from anon, authenticated;
  `;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(sql), []);
});

test('revoking only one of the two roles is not enough', () => {
  const sql = `
    create or replace function public.f() returns void language sql security definer as $$ select 1 $$;
    revoke execute on function public.f() from public, anon;
  `;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(sql), ['f']);
});

test('a revoke on one overload does not cover another', () => {
  const sql = `
    create function public.lookup(q text, n int) returns int language sql as $$ select 1 $$;
    revoke execute on function public.lookup(text, int) from public, anon, authenticated;
    create function public.lookup(q text) returns int language sql security definer as $$ select 1 $$;
  `;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(sql), ['lookup']);
});

test('finds SECURITY DEFINER written after the body', () => {
  const sql = `
    create function public.after_body() returns int as $f$ select 1 $f$ language sql security definer;
  `;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(sql), ['after_body']);
});

test('finds SECURITY DEFINER set by ALTER FUNCTION', () => {
  const sql = `
    create function public.made_plain(x uuid) returns int language sql as $$ select 1 $$;
    revoke execute on function public.made_plain(uuid) from anon, authenticated;
    alter function public.made_plain(uuid) security definer;
  `;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(sql), ['made_plain']);
});

test('a plain function does not inherit the next function SECURITY DEFINER', () => {
  // The scan is bounded at the body marker. Unbounded, `invoker_fn` would be
  // reported because a definer function is declared after it.
  const sql = `
    create or replace function public.invoker_fn() returns void language sql as $$ select 1 $$;
    create or replace function public.definer_fn() returns void language sql security definer as $$ select 1 $$;
    revoke execute on function public.definer_fn() from public, anon, authenticated;
  `;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(sql), []);
});

test('a trailing SECURITY DEFINER is read up to its own statement only', () => {
  const sql = `
    create function public.plain_one() returns int language sql as $$ select 1 $$;
    create function public.definer_two() returns int as $$ select 2 $$ language sql security definer;
    revoke execute on function public.definer_two() from public, anon, authenticated;
  `;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(sql), []);
});

// The rule reads the corpus in order, statement by statement (scripts/lib/definer-rule.mjs).

const CLOSED = 'from public, anon, authenticated';
const definer = (sig) =>
  `create function ${sig} returns int language sql security definer as $$ select 1 $$;`;

test('a revoke on a table does not reach into the next statement', () => {
  // The rule before ruling 826 ran a REVOKE on to the first FROM after an ON FUNCTION: here, the third
  // statement's, so the grant to anon read as closed.
  const sql = `
    ${definer('public.f(x uuid)')}
    revoke all on public.some_table from anon, authenticated;
    grant execute on function public.f(uuid) to anon;
    revoke select on public.other_table from anon, authenticated;
  `;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(sql), ['f']);
});

test('a grant after the revokes opens it again; REVOKE GRANT OPTION FOR closes nothing', () => {
  const reopened = `${definer('public.f(x uuid)')} revoke execute on function public.f(uuid) ${CLOSED};
    grant execute on function public.f(uuid) to anon;`;
  const option = `${definer('public.g()')} revoke grant option for execute on function public.g() ${CLOSED};`;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(reopened), ['f']);
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(option), ['g']);
});

test('DROP and CREATE again starts it open; CREATE OR REPLACE keeps its revokes', () => {
  // OR REPLACE after the DROP: only forgetting the dropped function's revokes opens it.
  const recreated = `${definer('public.f()')} revoke execute on function public.f() ${CLOSED};
    drop function public.f();
    create or replace function public.f() returns int language sql security definer as $$ select 1 $$;`;
  const replaced = `${definer('public.g()')} revoke execute on function public.g() ${CLOSED};
    create or replace function public.g() returns int language sql security definer as $$ select 2 $$;`;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(recreated), ['f']);
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(replaced), []);
});

test('ALTER FUNCTION ... SECURITY INVOKER closes it; ALTER without arguments reaches every overload', () => {
  const invoker = `${definer('public.f()')} alter function public.f() security invoker;`;
  const bare = `create function public.h(a int) returns int language sql as $$ select 1 $$;
    revoke execute on function public.h(int) from anon, authenticated;
    alter function public.h security definer;`;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(invoker), []);
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(bare), ['h']);
});

test('a SQL-standard RETURN body: found, and no borrowing across statements', () => {
  const sql = `
    create function public.plain() returns int language sql return 1;
    create function public.std() returns int language sql security definer return 2;
  `;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(sql), ['std']);
});

test('commas inside quoted defaults, nested types and OUT arguments do not change the count', () => {
  const sql = `
    create function public.f(a jsonb default '{"x": 1, "y": 2}', b numeric(10, 2), out c int)
      returns int language sql security definer as $$ select 1 $$;
    revoke execute on function public.f(jsonb, numeric) ${CLOSED};
  `;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(sql), []);
});

test('several targets in one revoke, roles in capitals or quoted, all count', () => {
  const sql = `
    ${definer('public.a(x uuid)')} ${definer('public.b(x uuid)')}
    REVOKE EXECUTE ON FUNCTION public.a(uuid), public.b(uuid) FROM PUBLIC, "anon", AUTHENTICATED;
  `;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(sql), []);
});

test('the schema tells functions apart, and a schema-wide revoke reaches only its schema', () => {
  const other = `${definer('public.f(x uuid)')} revoke execute on function audit.f(uuid) ${CLOSED};`;
  const wide = `${definer('public.f(x uuid)')} revoke execute on all routines in schema public ${CLOSED};`;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(other), ['f']);
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(wide), []);
});

test('a body that says SECURITY DEFINER does not make its function one', () => {
  const sql = `
    create function public.talks() returns text language sql as $$ select 'security definer' $$;
    create function public.quoted() returns text language sql as 'select ''security definer''';
  `;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(sql), []);
});

test('a revoke written inside a string or a DO block is not read as one', () => {
  const sql = `
    ${definer('public.f()')}
    do $do$ begin execute 'revoke execute on function public.f() ${CLOSED}'; end $do$;
  `;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(sql), ['f']);
});

test('quoted text with a `;` in it stays one string: doubled quotes, E-strings, nested dollar tags', () => {
  const sql = `
    create function public.a() returns text language sql as 'select ''x;''';
    create function public.b() returns text language sql as E'select \\'y;\\'';
    create function public.c() returns text language sql as $f$ select $$z;$$ $f$;
    ${definer('public.d()')}
  `;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(sql), ['d']);
});

test('a quote with no closer throws, so it cannot blank the rest of the corpus', () => {
  assert.throws(
    () => securityDefinerFunctionsReachableByAnon(`select 'open; ${definer('public.f()')}`),
    /never closes/,
  );
});

test("a quoted identifier is a name, and a ' inside it opens nothing", () => {
  const sql = `
    create function public."O'Brien"() returns int language sql security definer as $$ select 1 $$;
    revoke execute on function public."O'Brien"() ${CLOSED};
    create function public."Mixed"() returns int language sql security definer as $$ select 1 $$;
    revoke execute on function public.mixed() ${CLOSED};
  `;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(sql), ['Mixed']);
});

test('an unqualified name is public; DROP ... IF EXISTS ... CASCADE forgets it', () => {
  const sql = `
    create function f() returns int language sql security definer as $$ select 1 $$;
    revoke execute on function public.f() ${CLOSED};
    drop function if exists public.f() cascade;
    create or replace function public.f() returns int language sql security definer as $$ select 1 $$;
  `;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(sql), ['f']);
});

test('a procedure counts as a function, and a revoke ON PROCEDURE closes it', () => {
  const sql = `
    create procedure public.p(a int) language sql security definer as $$ select 1 $$;
    revoke execute on procedure public.p(int) ${CLOSED};
    create procedure public.q() language sql security definer as $$ select 1 $$;
  `;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(sql), ['q']);
});

test('RENAME TO and SET SCHEMA move a function; DROP SCHEMA forgets its functions', () => {
  const renamed = `${definer('public.old_name()')}
    alter function public.old_name() rename to new_name;
    revoke execute on function public.new_name() ${CLOSED};`;
  const moved = `${definer('public.f()')} alter function public.f() set schema audit;
    revoke execute on function public.f() ${CLOSED};`;
  const dropped = `${definer('audit.g()')} drop schema audit cascade;`;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(renamed), []);
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(moved), ['f']);
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(dropped), []);
});

test('a `$` inside a name opens no dollar quote', () => {
  // Named once: read as a `$b$` tag, it would never close.
  const sql = `
    create function public.a$b$c() returns int language sql as $$ select 1 $$;
    ${definer('public.after()')}
  `;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(sql), ['after']);
});

test("a ' inside a quoted name opens no string", () => {
  // Named once: read as a string, it would never close.
  const sql = `
    create function public."it's"() returns int language sql as $$ select 1 $$;
    ${definer('public.after()')}
  `;
  assert.deepEqual(securityDefinerFunctionsReachableByAnon(sql), ['after']);
});
