/**
 * Only the API writes the record of a ruleset re-pin (migration 0227, operator
 * ruling "Re-pin log", the 0216 pattern).
 *
 * 0150's FOR ALL policy let a super admin rewrite or delete the record of an
 * audited re-pin through PostgREST: an audit record must have one writer. The
 * policy becomes a SELECT policy of the same reach and the two public roles
 * lose the write grants. This reads the migrations in order and asserts the
 * LAST word on the table, so a later migration that brings a write policy or
 * grant back reds here. The running database is `pnpm db:rls-probe`'s
 * (API_ONLY_WRITES, as the seeded organisation admin).
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
  .map((text) => text.replace(/\s+/g, ' ').trim().toLowerCase())
  .filter((text) => text !== '');

const lastIndex = (match: (statement: string) => boolean) =>
  statements.reduce((last, statement, index) => (match(statement) ? index : last), -1);

const TABLE = 'public.tournament_ruleset_repins';
const DROPPED = 'super admins manage tournament ruleset repins';
const READS: Record<string, string> = {
  'super admins read tournament ruleset repins': `create policy "super admins read tournament ruleset repins" on ${TABLE} for select to authenticated using (public.is_super_admin())`,
  'org members read tournament ruleset repins': `create policy "org members read tournament ruleset repins" on ${TABLE} for select to authenticated using (public.has_org_role(public.event_org_id(event_id), 'editor'))`,
};

describe('the record of a ruleset re-pin: only the API writes it', () => {
  it('drops the FOR ALL policy, and no later migration creates a write policy', () => {
    const dropped = lastIndex((s) => s === `drop policy "${DROPPED}" on ${TABLE}`);
    const created = lastIndex(
      (s) =>
        s.startsWith('create policy') &&
        / on (public\.)?tournament_ruleset_repins /.test(`${s} `) &&
        !/ for select /.test(`${s} `),
    );
    expect(dropped).toBeGreaterThan(-1);
    expect(created).toBeLessThan(dropped);
  });

  it.each(Object.entries(READS))('keeps the read "%s", whole', (name, policy) => {
    expect(statements.filter((s) => s.startsWith(`create policy "${name}"`)).at(-1)).toBe(policy);
    expect(lastIndex((s) => s.startsWith('drop policy') && s.includes(`"${name}"`))).toBeLessThan(
      lastIndex((s) => s === policy),
    );
  });

  it('revokes the three write grants from both public roles, and none comes back', () => {
    const revoked = lastIndex(
      (s) => s === `revoke insert, update, delete on ${TABLE} from anon, authenticated`,
    );
    const granted = lastIndex(
      (s) =>
        s.startsWith('grant') &&
        / on (table )?(public\.)?([a-z_.]+, )*(public\.)?tournament_ruleset_repins[ ,]/.test(
          `${s} `,
        ) &&
        /\b(insert|update|delete|all)\b/.test(s.split(' on ')[0]!),
    );
    expect(revoked).toBeGreaterThan(-1);
    expect(granted).toBeLessThan(revoked);
  });
});
