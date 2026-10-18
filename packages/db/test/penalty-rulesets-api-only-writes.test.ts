/**
 * Only the API writes penalty rulesets (migration 0226, operator ruling
 * "Penalty door", the 0216 and 0225 pattern).
 *
 * 0016 let a club's admins insert and update their penalty rulesets and write
 * their entries through PostgREST, past the edit guard that refuses an edit of a
 * ruleset a running Tournament pins; 0151's versions table kept every write
 * grant. The write policies go and the two public roles lose the write grants
 * on the three tables, so a stray write fails loudly. This reads the migrations
 * in order and asserts the LAST word on each table, so a later migration that
 * brings a write policy or grant back reds here. The running database is
 * `pnpm db:rls-probe`'s (API_ONLY_WRITES, as the seeded organisation admin).
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

const TABLES = ['penalty_rulesets', 'penalty_ruleset_entries', 'penalty_ruleset_versions'];
const REVOKE = `revoke insert, update, delete on ${TABLES.join(', ')} from anon, authenticated`;
const DROPPED: Record<string, string[]> = {
  penalty_rulesets: ['penalty_rulesets_insert', 'penalty_rulesets_update'],
  penalty_ruleset_entries: ['penalty_entries_all'],
  penalty_ruleset_versions: [],
};

describe('penalty rulesets: only the API writes them', () => {
  it.each(TABLES)('drops every write policy on %s, and no later migration creates one', (table) => {
    const drops = DROPPED[table]!.map((name) =>
      lastIndex((s) => s === `drop policy "${name}" on ${table}`),
    );
    const created = lastIndex(
      (s) =>
        s.startsWith('create policy') &&
        new RegExp(` on (public\\.)?${table} `).test(`${s} `) &&
        !/ for select /.test(`${s} `),
    );
    for (const dropped of drops) {
      expect(dropped).toBeGreaterThan(-1);
      expect(created).toBeLessThan(dropped);
    }
    // A table with no write policy to drop (the versions) never had one, and gets none.
    if (drops.length === 0) expect(created).toBe(-1);
  });

  it('keeps the read policies, which reach every row the dropped ones did', () => {
    expect(
      statements.filter((s) => s.startsWith('create policy "penalty_rulesets_select"')).at(-1),
    ).toBe(
      'create policy "penalty_rulesets_select" on penalty_rulesets for select using (built_in or public_visibility or can_manage_penalty_ruleset(id))',
    );
    expect(
      lastIndex((s) => s.startsWith('drop policy') && s.includes('"penalty_rulesets_select"')),
    ).toBeLessThan(lastIndex((s) => s.startsWith('create policy "penalty_rulesets_select"')));
    expect(
      statements.filter((s) => s.startsWith('create policy "penalty_entries_select"')).at(-1),
    ).toBe(
      'create policy "penalty_entries_select" on penalty_ruleset_entries for select using ( exists ( select 1 from penalty_rulesets pr where pr.id = ruleset_id and (pr.built_in or pr.public_visibility or can_manage_penalty_ruleset(pr.id)) ) )',
    );
    expect(
      lastIndex((s) => s.startsWith('drop policy') && s.includes('"penalty_entries_select"')),
    ).toBeLessThan(lastIndex((s) => s.startsWith('create policy "penalty_entries_select"')));
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
