/**
 * Only the API writes club scoring rulesets (migration 0225, operator ruling
 * "Club ruleset door", the 0216 pattern).
 *
 * 0055 let a club's owners and admins write their rows through PostgREST, past
 * the edit guard that freezes a ruleset a Tournament scores with, and past the
 * super admin's review of a shared one. The two FOR ALL policies become SELECT
 * policies with the same reach, and the two public roles lose the write grants
 * on both ruleset tables, so a stray write fails loudly. This reads the
 * migrations in order and asserts the LAST word on each table, so a later
 * migration that brings a write policy or grant back reds here. The running
 * database is `pnpm db:rls-probe`'s (API_ONLY_WRITES, as the seeded
 * organisation admin).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const migrationsDir = join(__dirname, '..', 'migrations');

const statements = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()
  .map((file) => readFileSync(join(migrationsDir, file), 'utf8').replace(/--[^\n]*/g, ''))
  .join('\n')
  .split(';')
  .map((text) =>
    text.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim().toLowerCase(),
  )
  .filter((text) => text !== '');

const lastIndex = (match: (statement: string) => boolean) =>
  statements.reduce((last, statement, index) => (match(statement) ? index : last), -1);

const TABLES = ['custom_rulesets', 'custom_ruleset_versions'];
const REVOKE = `revoke insert, update, delete on ${TABLES.join(', ')} from anon, authenticated`;
const DROPPED = ['custom_rulesets_super_admin_all', 'custom_rulesets_org_owner_manage'];

/** The read policies that replace them: the same reach, reads only. */
const READS: Record<string, string> = {
  custom_rulesets_super_admin_read:
    'create policy "custom_rulesets_super_admin_read" on custom_rulesets for select using (is_super_admin())',
  custom_rulesets_org_owner_read:
    'create policy "custom_rulesets_org_owner_read" on custom_rulesets for select using (' +
    'owner_organization_id is not null and exists (select 1 from organization_members om ' +
    'where om.organization_id = custom_rulesets.owner_organization_id and om.user_id = ' +
    "(select auth.uid()) and om.role in ('owner', 'admin')))",
};

describe('club scoring rulesets: only the API writes them', () => {
  it.each(DROPPED)('drops %s, and no later migration creates a write policy', (name) => {
    const dropped = lastIndex((s) => s === `drop policy "${name}" on custom_rulesets`);
    const created = lastIndex(
      (s) =>
        s.startsWith('create policy') &&
        / on (public\.)?custom_rulesets /.test(`${s} `) &&
        !/ for select /.test(`${s} `),
    );
    expect(dropped).toBeGreaterThan(-1);
    expect(created).toBeLessThan(dropped);
  });

  it.each(Object.entries(READS))('keeps the reads of the dropped policy as %s', (name, policy) => {
    const created = statements.filter((s) => s.startsWith(`create policy "${name}"`));
    expect(created.at(-1)).toBe(policy);
    expect(lastIndex((s) => s.startsWith(`drop policy if exists "${name}"`))).toBeLessThan(
      lastIndex((s) => s === policy),
    );
  });

  it.each(TABLES)(
    'revokes the three write grants on %s from both public roles, and none comes back',
    (table) => {
      const revoked = lastIndex((s) => s === REVOKE);
      const granted = lastIndex(
        (s) =>
          s.startsWith('grant') &&
          new RegExp(` on (table )?(public\\.)?([a-z_]+, )*${table}[ ,]`).test(`${s} `) &&
          /\b(insert|update|delete|all)\b/.test(s.split(' on ')[0]!),
      );
      expect(revoked).toBeGreaterThan(-1);
      expect(granted).toBeLessThan(revoked);
    },
  );
});
