/**
 * The reasons an organiser confirmed over are not public (migration 0205, W1.0).
 *
 * `referee_assignments_select` (0204) shows a public Tournament's assignment rows to anyone, and a
 * policy hides rows, never one field. W1 stores in `conflicts_jsonb` the rules an organiser
 * confirmed over, and "attends a Workshop at an overlapping time" names a private enrolment. So the
 * table's SELECT grant is split per column for both public roles, and that column is left out.
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
 * The last statement starting with `verb` that names `referee_assignments`, up to its semicolon;
 * with `privileges`, the last one whose privilege list matches it.
 */
function lastStatement(sql: string, verb: 'grant' | 'revoke', privileges?: RegExp): string {
  // `ON TABLE public.referee_assignments` and `ON ALL TABLES IN SCHEMA public` grant it too.
  const target =
    '(?:(?:table\\s+)?(?:public\\.)?referee_assignments\\b|all\\s+tables\\s+in\\s+schema\\s+public)';
  const pattern = new RegExp(`${verb}\\s[^;]*\\bon\\s+${target}[^;]*;`, 'gi');
  const hits = [...sql.matchAll(pattern)].map((hit) => hit[0]);
  const named = privileges
    ? hits.filter((hit) => privileges.test(hit.split(/\son\s/i)[0] ?? ''))
    : hits;
  return flat(named.at(-1));
}

describe('referee_assignments.conflicts_jsonb is not public', () => {
  const sql = allSql();

  it('takes the table-wide SELECT away from both public roles', () => {
    // 0209 revokes the writes (referee-rules-what-goes.test.ts); this pins the last word on SELECT.
    expect(lastStatement(sql, 'revoke', /\b(select|all)\b/i)).toBe(
      'revoke select on referee_assignments from anon, authenticated;',
    );
  });

  it('gives back every column but conflicts_jsonb', () => {
    expect(lastStatement(sql, 'grant')).toBe(
      'grant select (id, event_id, scope_type, lice_id, pool_id, match_id, role, status, ' +
        'auto_assigned, created_at, person_id) on referee_assignments to anon, authenticated;',
    );
  });
});
