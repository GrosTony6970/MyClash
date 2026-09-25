/**
 * The membership and platform-role checks answer an anonymous reader without
 * reading a table (migration 0201, operator ruling 111a).
 *
 * Each helper below reads a table whose own read policy calls a helper again.
 * For an anonymous reader that loop ran until Postgres stopped with "stack depth
 * limit exceeded", and it did so on EVERY anonymous read as soon as one platform
 * role existed: every policy starts with `is_super_admin()`, which reads
 * `platform_roles`, whose policy calls `is_platform_staff()`, which reads
 * `platform_roles` again. The live-update server checks each change as the
 * anonymous subscriber, so the public live channel carried errors, not rows.
 *
 * This reads the migrations in order and asserts each helper's LAST definition
 * WHOLE: the anonymous branch must come first, inside a CASE (Postgres does not
 * promise the order of AND's operands), and must not read a table. The signed-in
 * branch is the old body unchanged; its loop is ruled out of scope.
 *
 * It cannot see the running database, and no test here does: CI's `Database
 * replay` job does (`pnpm db:rls-probe`, ruling 114), reading a Postgres 17 replay
 * as anon with a platform role seeded. It sees only tables with rows in them, so a
 * new helper that loops over a table the probe never seeds still hides there.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const migrationsDir = join(__dirname, '..', 'migrations');

function allSql(): string {
  return readdirSync(migrationsDir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()
    .map((file) => readFileSync(join(migrationsDir, file), 'utf8').replace(/--[^\n]*/g, ''))
    .join('\n');
}

const flat = (text: string | null | undefined) =>
  (text ?? '').replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim().toLowerCase();

/** The last CREATE [OR REPLACE] FUNCTION statement for `name`, up to its closing `$$;`. */
function functionStatement(sql: string, name: string): string {
  const pattern = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${name}\\s*\\([\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$\\s*;`,
    'gi',
  );
  return flat([...sql.matchAll(pattern)].map((hit) => hit[0]).at(-1));
}

const ORG_ROLES =
  "case min_role when 'read_only' then role in ('read_only','scorekeeper','referee','workshop_lead','editor','admin','owner') " +
  "when 'scorekeeper' then role in ('scorekeeper','editor','admin','owner') " +
  "when 'editor' then role in ('editor','admin','owner') " +
  "when 'admin' then role in ('admin','owner') " +
  "when 'owner' then role = 'owner' else false end";

const EXPECTED: Record<string, string> = {
  is_super_admin:
    'create or replace function is_super_admin() returns boolean language sql stable as $$ select case ' +
    "when auth.uid() is null then coalesce(auth.jwt() ->> 'role' = 'super_admin', false) " +
    "else coalesce(auth.jwt() ->> 'role' = 'super_admin' or exists (select 1 from platform_roles " +
    "where user_id = auth.uid() and role = 'super_admin'), false) end; $$;",
  is_platform_staff:
    'create or replace function is_platform_staff() returns boolean language sql stable as $$ select case ' +
    "when auth.uid() is null then coalesce(auth.jwt() ->> 'role' = 'super_admin', false) " +
    "else coalesce(auth.jwt() ->> 'role' = 'super_admin' or exists (select 1 from platform_roles " +
    'where user_id = auth.uid()), false) end; $$;',
  is_org_member:
    'create or replace function is_org_member(org_id uuid) returns boolean language sql stable as $$ ' +
    'select case when auth.uid() is null then false else exists (select 1 from organization_members ' +
    'where organization_id = org_id and user_id = auth.uid()) end; $$;',
  has_org_role:
    'create or replace function has_org_role(org_id uuid, min_role text) returns boolean language sql stable as $$ ' +
    'select case when auth.uid() is null then false else exists (select 1 from organization_members ' +
    `where organization_id = org_id and user_id = auth.uid() and ${ORG_ROLES}) end; $$;`,
  has_league_user_role:
    'create or replace function has_league_user_role(target_league_id uuid, min_role text) returns boolean ' +
    'language sql stable as $$ select case when auth.uid() is null then false else exists (select 1 from ' +
    'league_user_roles where league_id = target_league_id and user_id = auth.uid() and case min_role ' +
    "when 'admin' then role in ('admin', 'owner') when 'owner' then role = 'owner' else false end) end; $$;",
  has_league_org_role:
    'create or replace function has_league_org_role(target_league_id uuid, min_role text) returns boolean ' +
    'language sql stable as $$ select case when auth.uid() is null then false else exists (select 1 from ' +
    'league_organization_roles lor join organization_members om on om.organization_id = lor.organization_id ' +
    'where lor.league_id = target_league_id and om.user_id = auth.uid() and case min_role ' +
    "when 'member' then lor.role in ('member', 'admin', 'owner') " +
    "when 'admin' then lor.role in ('admin', 'owner') and om.role in ('admin', 'owner') " +
    "when 'owner' then lor.role = 'owner' and om.role = 'owner' else false end) end; $$;",
  can_manage_penalty_ruleset:
    'create or replace function can_manage_penalty_ruleset(target_ruleset_id uuid) returns boolean ' +
    'language sql stable as $$ select case when auth.uid() is null then is_super_admin() ' +
    'else is_super_admin() or exists (select 1 from penalty_rulesets pr where pr.id = target_ruleset_id ' +
    "and pr.owner_organization_id is not null and has_org_role(pr.owner_organization_id, 'admin')) end; $$;",
};

describe('RLS helpers answer an anonymous reader without reading a table (0201, ruling 111a)', () => {
  const sql = allSql();

  for (const [name, expected] of Object.entries(EXPECTED)) {
    it(`${name}: the anonymous branch comes first and reads nothing`, () => {
      expect(functionStatement(sql, name)).toBe(flat(expected));
    });
  }
});
