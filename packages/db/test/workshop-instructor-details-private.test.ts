/**
 * What a Workshop says about its instructor is not readable through the database door (migration
 * 0260, operator ruling 565).
 *
 * `workshop_instructors_select` (0002) shows a published Workshop's lines to anyone, whatever its
 * Event's status or kind, and a policy hides rows, never one field. Slice 2.6b writes a bio, a club
 * line and a photo of the instructor into a line. So the table's SELECT grant is split per column
 * for both public roles, and those three columns are left out. The API reads them with the service
 * role.
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
 * The last statement starting with `verb` that names `workshop_instructors`, up to its semicolon;
 * with `privileges`, the last one whose privilege list matches it.
 */
function lastStatement(sql: string, verb: 'grant' | 'revoke', privileges?: RegExp): string {
  // `ON TABLE public.workshop_instructors` and `ON ALL TABLES IN SCHEMA public` grant it too.
  const target =
    '(?:(?:table\\s+)?(?:public\\.)?workshop_instructors\\b|all\\s+tables\\s+in\\s+schema\\s+public)';
  const pattern = new RegExp(`${verb}\\s[^;]*\\bon\\s+${target}[^;]*;`, 'gi');
  const hits = [...sql.matchAll(pattern)].map((hit) => hit[0]);
  const named = privileges
    ? hits.filter((hit) => privileges.test(hit.split(/\son\s/i)[0] ?? ''))
    : hits;
  return flat(named.at(-1));
}

describe("a Workshop's instructor details are not readable through the database door (565)", () => {
  const sql = allSql();

  it('takes the table-wide SELECT away from both public roles', () => {
    expect(lastStatement(sql, 'revoke', /\b(select|all)\b/i)).toBe(
      'revoke select on public.workshop_instructors from anon, authenticated;',
    );
  });

  it('gives back every column but bio, affiliation and photo_url', () => {
    expect(lastStatement(sql, 'grant')).toBe(
      'grant select (id, workshop_id, global_person_id, display_name, sort_order) ' +
        'on public.workshop_instructors to anon, authenticated;',
    );
  });
});
