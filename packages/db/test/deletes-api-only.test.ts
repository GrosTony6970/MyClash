/**
 * Only the API deletes an Event or a club (migration 0237, operator rulings 93 and 95, the 0233
 * pattern).
 *
 * 0002's `events_delete` let a club owner delete an Event straight through PostgREST, past the
 * API's checks (an Event with recorded results, or an archived one, needs a deletion request);
 * `orgs_delete` let a signed-in super admin delete a club past the API's HQ guard and its audit
 * line. Only the RLS helper loop stopped either, once 0237's deferred keys removed the other
 * accident that did. Both policies go and the two public roles lose DELETE on both tables; reads,
 * inserts and updates stay. This reads the migrations in order and asserts the LAST word, so a
 * later migration that brings back a delete policy, or a grant of DELETE that names the table,
 * reds here. A schema-wide grant is the running database's to catch: `pnpm db:rls-probe`
 * (API_ONLY_WRITES, each table's DELETE, as the seeded organisation admin) and 0237's post-check.
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

describe.each([
  {
    table: 'events',
    policy: 'events_delete',
    kept: ['events_select_public', 'events_insert', 'events_update'],
  },
  {
    table: 'organizations',
    policy: 'orgs_delete',
    kept: ['orgs_select', 'orgs_insert', 'orgs_update'],
  },
])('$table: only the API deletes a row', ({ table, policy, kept }) => {
  const on = (s: string) => new RegExp(` on (public\\.)?${table} `).test(`${s} `);

  it('drops the delete policy, and no later migration creates one', () => {
    const dropped = lastIndex((s) => s === `drop policy "${policy}" on public.${table}`);
    const created = lastIndex(
      (s) => s.startsWith('create policy') && on(s) && / for (delete|all) /.test(`${s} `),
    );
    expect(dropped).toBeGreaterThan(-1);
    expect(created).toBeLessThan(dropped);
  });

  it.each(kept)('keeps the policy %s', (name) => {
    const made = lastIndex((s) => s.startsWith(`create policy "${name}"`) && on(s));
    expect(made).toBeGreaterThan(-1);
    expect(lastIndex((s) => s.startsWith(`drop policy "${name}"`))).toBeLessThan(made);
  });

  it('revokes DELETE from both public roles, and no later grant names it again', () => {
    const revoked = lastIndex(
      (s) => s === `revoke delete on public.${table} from anon, authenticated`,
    );
    const granted = lastIndex(
      (s) =>
        s.startsWith('grant') &&
        new RegExp(` on (table )?(public\\.)?([a-z_.]+, )*(public\\.)?${table}[ ,]`).test(
          `${s} `,
        ) &&
        /\b(delete|all)\b/.test(s.split(' on ')[0]!),
    );
    expect(revoked).toBeGreaterThan(-1);
    expect(granted).toBeLessThan(revoked);
  });
});
