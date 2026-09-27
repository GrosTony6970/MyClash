/**
 * The fighter merge and its revert are ONE database function each (migration 0212, ruling 133).
 *
 * This reads the migrations in order and pins the LAST definition of each function on what the
 * text can show: the signature the API calls, invoker rights with a pinned search_path, the
 * ordered row lock taken before anything moves, and the grants (service role only). What the
 * functions DO — the follows, the stricter choices, the account link, the refusals, all or
 * nothing — is proven on a replayed Postgres by `scripts/db-merge-probe.mjs` (CI: Database replay).
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

/** The body of the last `create or replace function public.<name>(`, up to its closing `$$;`. */
function lastDefinition(name: string): { file: string; body: string } {
  const opener = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, 'i');
  const file = files.filter((candidate) => opener.test(sqlOf(candidate))).at(-1);
  expect(file, `no migration defines public.${name}`).toBeDefined();
  const sql = sqlOf(file!);
  const start = sql.search(opener);
  const end = sql.indexOf('$$;', sql.indexOf('$$', start) + 2);
  return { file: file!, body: flat(sql.slice(start, end + 3)) };
}

/** Every revoke / grant statement naming the function in its defining migration, flattened. */
function privileges(file: string, name: string, verb: 'revoke' | 'grant'): string[] {
  const sql = sqlOf(file);
  return [...sql.matchAll(new RegExp(`${verb}\\s[^;]*public\\.${name}\\s*\\([^;]*;`, 'gi'))].map(
    (hit) => flat(hit[0]),
  );
}

const FUNCTIONS = [
  {
    name: 'merge_fighters',
    signature:
      'p_source_id uuid, p_target_id uuid, p_actor_user_id uuid, p_reason text, p_source_snapshot jsonb, p_target_snapshot jsonb',
    types: 'uuid, uuid, uuid, text, jsonb, jsonb',
    returns: 'returns jsonb',
  },
  {
    name: 'revert_fighter_merge',
    signature: 'p_audit_log_id uuid, p_actor_user_id uuid',
    types: 'uuid, uuid',
    returns: 'returns void',
  },
] as const;

// A plain loop, not describe.each: its `$name` title prints the name quoted.
for (const { name, signature, types, returns } of FUNCTIONS)
  describe(`public.${name} (ruling 133)`, () => {
    const { file, body } = lastDefinition(name);

    it('takes the arguments the API sends, and runs with the caller’s rights', () => {
      expect(flat(new RegExp(`${name}\\s*\\(([^)]*)\\)`, 'i').exec(body)?.[1])).toBe(signature);
      expect(body).toContain(returns);
      expect(body).toContain('language plpgsql');
      expect(body).not.toContain('security definer');
      expect(body).toContain('set search_path = public, pg_catalog');
    });

    it('locks both profiles, in id order, before it reads or moves anything', () => {
      // FOR UPDATE, not FOR NO KEY UPDATE: it conflicts with the KEY SHARE lock an insert of a
      // follow, a person or an instructor pointing at either profile takes, so nothing new can
      // attach to either profile until the merge commits. Id order: two merges cannot deadlock.
      const lock = body.indexOf('order by id for update');
      expect(lock, 'no ordered FOR UPDATE lock').toBeGreaterThan(-1);
      for (const write of ['update public.directory_follows', 'update public.persons']) {
        expect(body.indexOf(write), `${write} before the lock`).toBeGreaterThan(lock);
      }
    });

    it('only the service role may call it, the public roles revoked by name', () => {
      const sig = `public.${name}(${types})`;
      expect(privileges(file, name, 'revoke')).toEqual([
        `revoke all on function ${sig} from public;`,
        `revoke execute on function ${sig} from anon, authenticated;`,
      ]);
      expect(privileges(file, name, 'grant')).toEqual([
        `grant execute on function ${sig} to service_role;`,
      ]);
    });
  });

describe('the merge record is written by the merge itself', () => {
  it('only these two functions insert into audit_log from SQL', () => {
    // Every other audit row goes through the API's insertAuditLog, which masks personal values
    // (audit-log.coverage.test.ts). These two write the record in the same transaction as the
    // merge; the snapshots arrive already masked by that same masker (merge.service.ts).
    const writers = files.filter((file) =>
      /insert\s+into\s+(public\.)?audit_log\b/i.test(sqlOf(file)),
    );
    expect(writers).toEqual([lastDefinition('merge_fighters').file]);
    for (const { name } of FUNCTIONS) {
      expect(lastDefinition(name).body).toContain(
        'insert into public.audit_log (actor_user_id, action, entity_type, entity_id, payload_json)',
      );
    }
  });
});
