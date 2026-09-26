/**
 * The per-bout and per-Pool crew doors store the reasons confirmed over (migration 0207, W1.2).
 *
 * `replace_match_referee_role` wrote '[]' into `conflicts_jsonb` whatever the organiser
 * confirmed (0194). This reads the migrations in order and pins the LAST definition and its
 * grants WHOLE: the reasons argument is written, the old 4-argument overload is gone (two
 * overloads make PostgREST refuse the call, PGRST203), and the public roles cannot call it.
 * It cannot see the running database; `pnpm db:migrations:replay` covers that.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const migrationsDir = join(__dirname, '..', 'migrations');

const files = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();
const sqlOf = (file: string) =>
  readFileSync(join(migrationsDir, file), 'utf8').replace(/--[^\n]*/g, '');
const flat = (text: string | undefined) =>
  (text ?? '').replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim().toLowerCase();

const DEFINITION = /create\s+or\s+replace\s+function\s+public\.replace_match_referee_role\s*\(/i;
const lastFile = files.filter((file) => DEFINITION.test(sqlOf(file))).at(-1)!;
const last = sqlOf(lastFile);

/** Every statement of the last defining migration that names the function, flattened. */
const statements = (verb: string) =>
  [...last.matchAll(new RegExp(`${verb}\\s[^;]*replace_match_referee_role[^;]*;`, 'gi'))].map(
    (hit) => flat(hit[0]),
  );

describe('replace_match_referee_role keeps the confirmed-over reasons', () => {
  it('is last defined with the reasons argument, and writes it', () => {
    const signature = flat(/replace_match_referee_role\s*\(([^)]*)\)\s*returns/i.exec(last)?.[1]);
    expect(signature).toBe(
      "p_event_id uuid, p_role text, p_person_id uuid, p_match_ids uuid[], p_conflicts jsonb default '[]'::jsonb",
    );
    expect(flat(last)).toContain("coalesce(p_conflicts, '[]'::jsonb)");
    expect(flat(last)).not.toContain("'assigned', '[]'::jsonb");
  });

  it('writes no lice and no pool on a match-scoped row', () => {
    // referee_assignments_scope_check (0091): a scope_type='match' row carries both NULL.
    const columns = /insert\s+into\s+public\.referee_assignments\s*\(([^)]*)\)/i.exec(last)?.[1];
    expect(columns, 'no column list on the function insert').toBeDefined();
    const names = (columns ?? '').split(',').map((column) => column.trim());
    expect(names).toContain('match_id');
    expect(names).not.toContain('lice_id');
    expect(names).not.toContain('pool_id');
  });

  it('drops the 4-argument overload in the same migration', () => {
    expect(statements('drop function')).toEqual([
      'drop function if exists public.replace_match_referee_role(uuid, text, uuid, uuid[]);',
    ]);
  });

  it('only the service role may call it, the public roles revoked by name', () => {
    const sig = 'public.replace_match_referee_role(uuid, text, uuid, uuid[], jsonb)';
    expect(statements('revoke')).toEqual([
      `revoke all on function ${sig} from public;`,
      `revoke execute on function ${sig} from anon, authenticated;`,
    ]);
    expect(statements('grant')).toEqual([`grant execute on function ${sig} to service_role;`]);
  });
});
