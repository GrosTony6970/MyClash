/**
 * Who was in a Workshop's room is not readable through the database door (migration 0259,
 * operator ruling 548).
 *
 * `workshop_enrollments_select` (0002) shows every booking of an Event to any member of the
 * organising club, and a policy hides rows, never one field. A check-in says where a person
 * physically was and when, like the desk's arrivals (0174), which nobody reads through PostgREST
 * since 0247. So the table's SELECT grant is split per column for both public roles, and the two
 * check-in columns are left out. The API reads them with the service role.
 *
 * This reads the migrations in order and asserts the LAST revoke and grant on the table WHOLE, so a
 * column slipped into the grant cannot pass as a substring. It cannot see the running database;
 * `pnpm db:migrations:replay` then `pnpm db:rls-probe` (PRIVATE_COLUMNS) cover that.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const migrationsDir = join(__dirname, '..', 'migrations');

function allSql(): string {
  return readdirSync(migrationsDir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()
    .map((file) => readFileSync(join(migrationsDir, file), 'utf8').replace(/--[^\n]*/g, ''))
    .join('\n');
}

const flat = (text: string | undefined) =>
  (text ?? '').replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim().toLowerCase();

/**
 * The last statement starting with `verb` that names `workshop_enrollments`, up to its semicolon;
 * with `privileges`, the last one whose privilege list matches it.
 */
function lastStatement(sql: string, verb: 'grant' | 'revoke', privileges?: RegExp): string {
  // `ON TABLE public.workshop_enrollments` and `ON ALL TABLES IN SCHEMA public` grant it too.
  const target =
    '(?:(?:table\\s+)?(?:public\\.)?workshop_enrollments\\b|all\\s+tables\\s+in\\s+schema\\s+public)';
  const pattern = new RegExp(`${verb}\\s[^;]*\\bon\\s+${target}[^;]*;`, 'gi');
  const hits = [...sql.matchAll(pattern)].map((hit) => hit[0]);
  const named = privileges
    ? hits.filter((hit) => privileges.test(hit.split(/\son\s/i)[0] ?? ''))
    : hits;
  return flat(named.at(-1));
}

describe('a Workshop check-in is not readable through the database door (548)', () => {
  const sql = allSql();

  it('takes the table-wide SELECT away from both public roles', () => {
    expect(lastStatement(sql, 'revoke', /\b(select|all)\b/i)).toBe(
      'revoke select on public.workshop_enrollments from anon, authenticated;',
    );
  });

  it('gives back every column but checked_in_at and check_in_source', () => {
    expect(lastStatement(sql, 'grant')).toBe(
      'grant select (id, workshop_session_id, user_id, status, position, enrolled_at, updated_at, ' +
        'global_person_id) on public.workshop_enrollments to anon, authenticated;',
    );
  });
});
