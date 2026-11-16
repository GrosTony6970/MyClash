/**
 * The web roles read no fighter profile through the database (migration 0272, operator rulings 820
 * and 823).
 *
 * `global_persons_select` (0187) chose which rows the public saw and hid no column, so a listed
 * fighter's email and date of birth went to anyone holding the anon key. 0272 takes SELECT on the
 * table from both web roles, drops the policy no web role can reach any more, closes
 * `lookup_global_persons` to them and to PUBLIC while granting it to the service role (the API's
 * fuzzy search), and takes the `global_persons` branch out of the three referee policies that read
 * it: a policy subquery needs SELECT on what it names, so leaving it would fail every anonymous read
 * of those tables. Two of them had nothing else for the public and go whole (ruling 823).
 *
 * This reads the migrations in order and pins the LAST word on each, so a later migration that
 * gives the door back goes red here, not only on the replay. It cannot see the running database:
 * `pnpm db:migrations:replay` then `pnpm db:rls-probe` (check 21) cover that.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const migrationsDir = join(__dirname, '..', 'migrations');
const MIGRATION = '0272_global_persons_api_only_reads.sql';

const strip = (text: string) => text.replace(/--[^\n]*/g, '');

function files(): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
}

const allSql = () =>
  files()
    .map((file) => strip(readFileSync(join(migrationsDir, file), 'utf8')))
    .join('\n');

/** The SQL of every migration after 0272, comments out. */
const laterSql = () =>
  files()
    .filter((file) => file > MIGRATION)
    .map((file) => strip(readFileSync(join(migrationsDir, file), 'utf8')))
    .join('\n');

const flat = (text: string | undefined) =>
  (text ?? '').replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim().toLowerCase();

/** Every statement matching `pattern` (which must end at its semicolon), flattened, in order. */
const statements = (sql: string, pattern: RegExp) =>
  [...sql.matchAll(pattern)].map((hit) => ({ at: hit.index, text: flat(hit[0]) }));

const lastIndex = (sql: string, pattern: RegExp) => statements(sql, pattern).at(-1)?.at ?? -1;

const WEB_GRANTEE = /\bto\s[^;]*\b(anon|authenticated|public)\b/i;
const GLOBAL_PERSONS = '(?:table\\s+)?(?:public\\.)?global_persons\\b';
const ALL_TABLES = 'all\\s+tables\\s+in\\s+schema\\s+public';
const LOOKUP = '(?:function\\s+)?(?:public\\.)?lookup_global_persons\\s*\\(';

describe('the web roles read no fighter profile through the database', () => {
  const sql = allSql();

  it('takes SELECT on global_persons from both web roles, by name', () => {
    const revokes = statements(
      sql,
      new RegExp(`revoke\\s[^;]*\\bon\\s+${GLOBAL_PERSONS}[^;]*;`, 'gi'),
    ).filter((s) => /\b(select|all)\b/.test(s.text.split(' on ')[0] ?? ''));
    expect(revokes.at(-1)?.text).toBe(
      'revoke select on public.global_persons from anon, authenticated;',
    );
  });

  it('gives no web role a read of global_persons again, table or column', () => {
    const grants = statements(
      laterSql(),
      new RegExp(`grant\\s[^;]*\\bon\\s+(?:${GLOBAL_PERSONS}|${ALL_TABLES})[^;]*;`, 'gi'),
    ).filter((s) => WEB_GRANTEE.test(s.text));
    expect(grants.map((s) => s.text)).toEqual([]);
  });

  it('drops global_persons_select and puts no policy back on the table', () => {
    expect(lastIndex(sql, /drop\s+policy\s+"?global_persons_select"?\s[^;]*;/gi)).toBeGreaterThan(
      lastIndex(sql, /create\s+policy\s+"?global_persons_select"?\s[^;]*;/gi),
    );
    const later = statements(
      laterSql(),
      new RegExp(`create\\s+policy\\s[^;]*\\bon\\s+${GLOBAL_PERSONS}[^;]*;`, 'gi'),
    );
    expect(later.map((s) => s.text)).toEqual([]);
  });

  it.each(['referee_qualifications_select', 'event_referees_select'])(
    'drops %s and never creates it again (ruling 823)',
    (name) => {
      expect(
        lastIndex(sql, new RegExp(`drop\\s+policy\\s+"?${name}"?\\s[^;]*;`, 'gi')),
      ).toBeGreaterThan(
        lastIndex(sql, new RegExp(`create\\s+policy\\s+"?${name}"?\\s[^;]*;`, 'gi')),
      );
    },
  );

  it('leaves no later policy reading global_persons', () => {
    const later = statements(laterSql(), /create\s+policy\s[^;]*;/gi).filter((s) =>
      /\bglobal_persons\b/.test(s.text.replace(/^create policy "?[a-z_]+"? on \S+/, '')),
    );
    expect(later.map((s) => s.text)).toEqual([]);
  });

  it('closes lookup_global_persons to PUBLIC and both web roles, and grants it to the API', () => {
    const own = strip(readFileSync(join(migrationsDir, MIGRATION), 'utf8'));
    const onLookup = statements(
      own,
      new RegExp(`(?:grant|revoke)\\s[^;]*\\bon\\s+${LOOKUP}[^;]*;`, 'gi'),
    );
    expect(onLookup.map((s) => s.text)).toEqual([
      'revoke all on function public.lookup_global_persons(text, integer, double precision) from public;',
      'revoke execute on function public.lookup_global_persons(text, integer, double precision) from anon, authenticated;',
      'grant execute on function public.lookup_global_persons(text, integer, double precision) to service_role;',
    ]);
    const regrants = statements(
      laterSql(),
      new RegExp(
        `grant\\s[^;]*\\bon\\s+(?:${LOOKUP}|all\\s+functions\\s+in\\s+schema\\s+public)[^;]*;`,
        'gi',
      ),
    ).filter((s) => WEB_GRANTEE.test(s.text));
    expect(regrants.map((s) => s.text)).toEqual([]);
  });
});
