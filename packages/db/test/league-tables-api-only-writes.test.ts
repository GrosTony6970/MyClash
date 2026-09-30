/**
 * Only the API writes the League tables (migration 0216, the 0209 pattern).
 *
 * 0015 let any signed-in user insert a League, and a League's managers write its roles, links,
 * results and standings through PostgREST, past the API's checks and the scoring engine. The write
 * policies go and the two public roles lose the write grants, so a stray write fails loudly. This
 * reads the migrations in order and asserts the LAST word on each table, so a later migration that
 * brings a write policy or grant back reds here. The running database is `pnpm db:rls-probe`'s
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

const TABLES = [
  'leagues',
  'league_organization_roles',
  'league_user_roles',
  'league_tournament_links',
  'league_tournament_results',
  'league_rankings',
];
const REVOKE = `revoke insert, update, delete on ${TABLES.join(', ')} from anon, authenticated`;
const DROPPED: Record<string, string[]> = {
  leagues: ['leagues_insert', 'leagues_update'],
  league_organization_roles: ['league_org_roles_all'],
  league_user_roles: ['league_user_roles_all'],
  league_tournament_links: ['league_links_all'],
  league_tournament_results: ['league_results_all'],
  league_rankings: ['league_rankings_all'],
};

describe('the League tables: only the API writes them', () => {
  it.each(TABLES)('drops every write policy on %s, and no later migration creates one', (table) => {
    const drops = DROPPED[table]!.map((name) =>
      lastIndex((s) => s === `drop policy "${name}" on ${table}`),
    );
    const created = lastIndex(
      (s) =>
        s.startsWith('create policy') &&
        new RegExp(` on ${table} `).test(`${s} `) &&
        !/ for select /.test(`${s} `),
    );
    for (const dropped of drops) {
      expect(dropped).toBeGreaterThan(-1);
      expect(created).toBeLessThan(dropped);
    }
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
