/**
 * Only the API writes a Match and what is recorded on it, and only the API
 * deletes a phase or a Registration (migration 0238, operator rulings 96, 97,
 * 99 and 100; the 0233 pattern).
 *
 * 0002 and 0016 let a scorekeeper or an organisation admin rewrite a Match, its
 * Exchanges, events and penalties straight through PostgREST, an admin delete a
 * phase with every Match in it, and an editor delete a Registration with its
 * cards, past every door of the API. The write policies go, the two public roles
 * lose the write grants on the five Match tables and the delete grant on
 * `phases` and `registrations`. This reads the migrations in order
 * and asserts the LAST word, so a later migration that brings a write policy or
 * a grant back reds here. The running database is `pnpm db:rls-probe`'s
 * (API_ONLY_WRITES as the seeded organisation admin, the anon grants off the
 * catalogue, the reads in VERDICTS).
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

const onTable = (table: string) => (s: string) =>
  new RegExp(` on (public\\.)?${table} `).test(`${s} `);

/**
 * A later grant of one of `verbs` to a web role (or to PUBLIC, which both inherit) that reaches
 * `table`, by name or by "all tables".
 */
const grantsBack = (table: string, verbs: string) => (s: string) =>
  s.startsWith('grant') &&
  (new RegExp(` on (table )?(public\\.)?([a-z_.]+, )*(public\\.)?${table}[ ,]`).test(`${s} `) ||
    / on all tables in schema public /.test(`${s} `)) &&
  / to .*\b(anon|authenticated|public)\b/.test(s.split(' on ').slice(1).join(' on ')) &&
  new RegExp(`\\b(${verbs}|all)\\b`).test(s.split(' on ')[0]!);

const MATCH_TABLES =
  'public.matches, public.exchanges, public.match_events, public.match_penalties, public.match_forfeits';

describe.each([
  { table: 'matches', drops: ['drop policy "matches_write"'], read: 'matches_select' },
  {
    table: 'exchanges',
    drops: ['drop policy "exchanges_insert"', 'drop policy "exchanges_update"'],
    read: 'exchanges_select',
  },
  {
    table: 'match_events',
    drops: ['drop policy "match_events_write"'],
    read: 'match_events_select',
  },
  {
    table: 'match_penalties',
    drops: ['drop policy "match_penalties_all"'],
    read: 'match_penalties_select',
  },
  // 0032 made it unquoted, and it never had a read policy.
  { table: 'match_forfeits', drops: ['drop policy match_forfeits_service_all'], read: null },
])('$table: only the API writes it', ({ table, drops, read }) => {
  it('drops every write policy, and no later migration creates one', () => {
    const dropped = drops.map((drop) => lastIndex((s) => s === `${drop} on public.${table}`));
    const created = lastIndex(
      (s) => s.startsWith('create policy') && onTable(table)(s) && !/ for select /.test(`${s} `),
    );
    for (const index of dropped) {
      expect(index).toBeGreaterThan(-1);
      expect(created).toBeLessThan(index);
    }
  });

  it.runIf(read !== null)('keeps the read', () => {
    const kept = lastIndex(
      (s) => s.startsWith(`create policy "${read}"`) && / for select /.test(`${s} `),
    );
    expect(kept).toBeGreaterThan(-1);
    // Quoted or not: 0032 made a policy name unquoted.
    const dropped = new RegExp(`^drop policy (if exists )?"?${read}"? `);
    expect(lastIndex((s) => dropped.test(s))).toBeLessThan(kept);
  });

  it('revokes the three write grants from both public roles, and none comes back', () => {
    const revoked = lastIndex(
      (s) => s === `revoke insert, update, delete on ${MATCH_TABLES} from anon, authenticated`,
    );
    expect(revoked).toBeGreaterThan(-1);
    expect(lastIndex(grantsBack(table, 'insert|update|delete'))).toBeLessThan(revoked);
  });
});

// A delete of either takes Match rows by cascade (rulings 99, 100). A policy cannot pass a revoked
// privilege, so the grant is the last word.
describe.each(['phases', 'registrations'])('%s: only the API deletes it', (table) => {
  it('revokes the delete from both public roles, and no grant comes back', () => {
    const revoked = lastIndex(
      (s) => s === 'revoke delete on public.phases, public.registrations from anon, authenticated',
    );
    expect(revoked).toBeGreaterThan(-1);
    expect(lastIndex(grantsBack(table, 'delete'))).toBeLessThan(revoked);
  });
});
