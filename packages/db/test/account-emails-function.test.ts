/**
 * `account_emails` hands the API the own addresses of a list of accounts (migration 0217, operator
 * ruling 215). It reads `auth.users`, so it runs with its owner's rights, and PostgREST serves
 * every function of `public` at `/rpc/<name>`: open to a visitor, it would hand out the address
 * behind any account id.
 *
 * This reads the migrations in order and pins the LAST definition on what the text can show: the
 * argument the API sends, the rights it runs with, an empty search path, the list it answers for,
 * and every grant or revoke that names the function, in that migration or a later one. That anon
 * and a signed-in user are in fact refused, and what the function answers, is proven on a replayed
 * Postgres by `scripts/db-rls-probe.mjs` (CI: Database replay).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const migrationsDir = join(__dirname, '..', 'migrations');
const NAME = 'account_emails';
const OPENER = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${NAME}\\s*\\(`, 'i');
const NAMED = new RegExp(`\\b${NAME}\\b`);

const sqlOf = (file: string) =>
  readFileSync(join(migrationsDir, file), 'utf8').replace(/--[^\n]*/g, '');
const flat = (text: string) =>
  text.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim().toLowerCase();

const migrations = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();
const defining = migrations.map((file) => OPENER.test(sqlOf(file))).lastIndexOf(true);

describe(`public.${NAME} (ruling 215)`, () => {
  // The defining migration and every later one: a grant can come back in either.
  const sql = defining < 0 ? '' : flat(migrations.slice(defining).map(sqlOf).join('\n'));
  const start = sql.search(OPENER);
  const body = start < 0 ? '' : sql.slice(start, sql.indexOf('$$;', start) + 3);
  const statements = (verb: string) =>
    sql
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.startsWith(verb) && NAMED.test(statement));

  it('is defined by a migration', () => {
    expect(defining, `no migration defines public.${NAME}`).toBeGreaterThan(-1);
  });

  it('takes the list of account ids the API sends, and answers id and address', () => {
    expect(body).toContain(`public.${NAME}(p_user_ids uuid[])`);
    expect(body).toContain('returns table (user_id uuid, email text)');
  });

  it('runs with its owner’s rights, on names it spells out in full', () => {
    expect(body).toContain('security definer');
    // An empty path: a definer function that looks names up through a caller's path can be made
    // to run the caller's objects.
    expect(body).toContain("set search_path = ''");
    expect(body).toContain('from auth.users u');
  });

  it('answers only for the accounts of the list', () => {
    expect(body).toContain('where u.id = any (p_user_ids)');
  });

  it('every grant and revoke that names it: the service role only, the public roles by name', () => {
    const signature = `public.${NAME}(uuid[])`;
    expect(statements('revoke')).toEqual([
      `revoke all on function ${signature} from public`,
      `revoke execute on function ${signature} from anon, authenticated`,
    ]);
    expect(statements('grant')).toEqual([`grant execute on function ${signature} to service_role`]);
    // Its rights and its search path are set where it is created, and changed nowhere else.
    expect(statements('alter')).toEqual([]);
  });
});
