/**
 * Only the API writes a Tournament (migration 0233, operator ruling 1 of the
 * audited settings change, the 0216 pattern).
 *
 * 0002's `tournaments_write` let a super admin or an organisation admin rewrite
 * a Tournament's rules, card pin or status straight through PostgREST, past
 * every door of the API. The policy goes, the two public roles lose the write
 * grants, and 0224's two Tournament triggers and their function go with it: with
 * no write policy left they could never fire (ruling "0224 triggers"). This
 * reads the migrations in order and asserts the LAST word, so a later migration
 * that brings a write policy, a write grant or the triggers back reds here. The
 * running database is `pnpm db:rls-probe`'s (API_ONLY_WRITES, as the seeded
 * organisation admin; check 10 reads the triggers' absence).
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

const TABLE = 'public.tournaments';
const onTournaments = (s: string) => / on (public\.)?tournaments /.test(`${s} `);

describe('a Tournament: only the API writes it', () => {
  it('drops the FOR ALL policy, and no later migration creates a write policy', () => {
    const dropped = lastIndex((s) => s === `drop policy "tournaments_write" on ${TABLE}`);
    const created = lastIndex(
      (s) => s.startsWith('create policy') && onTournaments(s) && !/ for select /.test(`${s} `),
    );
    expect(dropped).toBeGreaterThan(-1);
    expect(created).toBeLessThan(dropped);
  });

  it('keeps the read', () => {
    const read = lastIndex(
      (s) => s.startsWith('create policy "tournaments_select"') && / for select /.test(`${s} `),
    );
    expect(read).toBeGreaterThan(-1);
    expect(
      lastIndex((s) => s.startsWith('drop policy') && s.includes('"tournaments_select"')),
    ).toBeLessThan(read);
  });

  it('revokes the three write grants from both public roles, and none comes back', () => {
    const revoked = lastIndex(
      (s) => s === `revoke insert, update, delete on ${TABLE} from anon, authenticated`,
    );
    const granted = lastIndex(
      (s) =>
        s.startsWith('grant') &&
        / on (table )?(public\.)?([a-z_.]+, )*(public\.)?tournaments[ ,]/.test(`${s} `) &&
        /\b(insert|update|delete|all)\b/.test(s.split(' on ')[0]!),
    );
    expect(revoked).toBeGreaterThan(-1);
    expect(granted).toBeLessThan(revoked);
  });

  it.each(['tournaments_ruleset_pair_insert', 'tournaments_ruleset_pair_update'])(
    'drops the 0224 trigger %s, and no later migration makes it again',
    (name) => {
      const dropped = lastIndex((s) => s === `drop trigger ${name} on ${TABLE}`);
      expect(dropped).toBeGreaterThan(-1);
      expect(
        lastIndex((s) => new RegExp(`^create (or replace )?trigger ${name}\\b`).test(s)),
      ).toBeLessThan(dropped);
    },
  );

  it('drops the function those triggers ran, and no later migration makes it again', () => {
    const dropped = lastIndex((s) => s === 'drop function public.ruleset_pair_in_its_club()');
    expect(dropped).toBeGreaterThan(-1);
    expect(
      lastIndex((s) =>
        /^create (or replace )?function (public\.)?ruleset_pair_in_its_club\b/.test(s),
      ),
    ).toBeLessThan(dropped);
    // The triggers go before the function they call: dropping the function first fails the replay.
    expect(
      lastIndex((s) => s === `drop trigger tournaments_ruleset_pair_update on ${TABLE}`),
    ).toBeLessThan(dropped);
  });
});
