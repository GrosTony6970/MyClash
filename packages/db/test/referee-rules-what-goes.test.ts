/**
 * What the one referee checker replaced goes (migration 0209, W1.4).
 *
 * Only the API writes `referee_assignments`: every door asks the checker and the lock. The org-admin
 * write policy of 0002 let PostgREST write past both, so it goes, and the two public roles lose the
 * write grants so a stray write fails loudly (ruling 144). This reads the migrations in order and
 * asserts the LAST word on each, so a later migration that brings one back reds here. The running
 * database is `pnpm db:rls-probe`'s (API_ONLY_WRITES, as the seeded organisation admin).
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

describe('referee_assignments: only the API writes it', () => {
  it('drops the org-admin write policy, and no later migration creates a write policy', () => {
    const dropped = lastIndex(
      (s) => s === 'drop policy "referee_assignments_write" on referee_assignments',
    );
    const created = lastIndex(
      (s) =>
        s.startsWith('create policy') &&
        / on referee_assignments /.test(`${s} `) &&
        !/ for select /.test(`${s} `),
    );
    expect(dropped).toBeGreaterThan(-1);
    expect(created).toBeLessThan(dropped);
  });

  it('revokes the three write grants from both public roles, and none comes back', () => {
    const revoked = lastIndex(
      (s) => s === 'revoke insert, update, delete on referee_assignments from anon, authenticated',
    );
    const granted = lastIndex(
      (s) =>
        s.startsWith('grant') &&
        / on (table )?(public\.)?referee_assignments /.test(`${s} `) &&
        /\b(insert|update|delete|all)\b/.test(s.split(' on ')[0]!),
    );
    expect(revoked).toBeGreaterThan(-1);
    expect(granted).toBeLessThan(revoked);
  });
});

describe('the columns nothing reads any more', () => {
  it.each([
    ['pool_assignment_settings', 'enable_officiate_vs_fight_rule'],
    ['pool_assignment_settings', 'enable_double_booked_rule'],
    ['pool_assignment_settings', 'enable_availability_rule'],
    ['pool_assignment_settings', 'enforce_fighter_referee_no_overlap'],
    ['matches', 'referee_id'],
  ])('%s.%s is dropped, and not added back', (table, column) => {
    const dropped = lastIndex(
      (s) => s.startsWith(`alter table ${table} `) && s.includes(`drop column ${column}`),
    );
    const added = lastIndex(
      (s) =>
        s.startsWith(`alter table ${table} `) &&
        new RegExp(`add column (if not exists )?${column}\\b`).test(s),
    );
    expect(dropped).toBeGreaterThan(-1);
    expect(added).toBeLessThan(dropped);
  });
});
