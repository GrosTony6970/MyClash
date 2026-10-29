/**
 * The status rule has one owner (migration 0246): `fighter_status_under` works out a Fighter's
 * status and when they crossed out; `settle_fighter_status` writes what it answers, and
 * `fighters_status_under` lists a Tournament's Registrations a forfeit rules change moves, in the
 * order the API settles them. Asserted from the migrations; what the functions answer on a live
 * database is probe checks 16 and 19 (`scripts/lib/fighter-status-probe.mjs`,
 * `scripts/lib/fighters-status-under-probe.mjs`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  allSql,
  createOf,
  flat,
  functionStatement,
  lastIndex,
  matches,
  routine,
} from './migration-sql';

const MANY = `create or replace function public.fighters_status_under(
    p_tournament uuid, p_rules_before jsonb, p_rules_after jsonb, p_also uuid[]
  )
  returns table (
    registration_id uuid, status_now text, status_before text, status_after text,
    crossed_at timestamptz
  )
  language sql stable security invoker set search_path = public, pg_catalog as $$
    select r.id, r.status, b.status, a.status, a.crossed_at
      from public.registrations r
      cross join lateral public.fighter_status_under(r.id, p_rules_before, r.entry_status) b
      cross join lateral public.fighter_status_under(r.id, p_rules_after, r.entry_status) a
     where r.tournament_id = p_tournament
       and (b.status <> a.status or r.status <> a.status or r.id = any(p_also))
     order by a.crossed_at nulls last, r.id;
  $$`;

const FUNCTIONS = [
  ['fighter_status_under', 'uuid, jsonb, text'],
  ['fighters_status_under', 'uuid, jsonb, jsonb, uuid[]'],
  ['settle_fighter_status', 'uuid, jsonb, timestamptz, text, text, boolean'],
] as const;

const escaped = (text: string) =>
  text.replace(/[[\]()]/g, (c) => `\\${c}`).replace(/,\s*/g, ',\\s*');

describe('one owner of a Fighter’s status', () => {
  const sql = allSql();
  const own = flat(
    readFileSync(
      join(__dirname, '..', 'migrations', '0246_forfeit_rules_audited_fighters_follow.sql'),
      'utf8',
    ).replace(/--[^\n]*/g, ''),
  );

  it('lists the moved, the out of step and the named, by when they crossed, through the one rule', () => {
    expect(functionStatement(sql, 'fighters_status_under')).toBe(flat(MANY));
  });

  it('works the status out once, read by the settle', () => {
    const under = functionStatement(sql, 'fighter_status_under');
    expect(under).toContain('returns table (status text, crossed_at timestamptz)');
    expect(under).toContain('language sql stable security invoker');
    expect(under).toContain('not f.under_out_status');
    expect(under).toContain('row_number() over (order by f.created_at, f.id)');
    expect(under).toContain('row_number() over (order by p.recorded_at, p.id)');
    expect(under).toContain('(select min(a.crossed) from arms a)');

    const settle = functionStatement(sql, 'settle_fighter_status');
    expect(settle).toContain(
      'select u.status into next_status from public.fighter_status_under(reg.id, p_rules, entry) u;',
    );
    expect(settle).not.toMatch(/match_forfeits|match_penalties|tournament_penalty_reviews/);
  });

  it.each(FUNCTIONS)('lets the service role alone call %s', (name, args) => {
    const created = lastIndex(sql, createOf(name));
    const revoke = lastIndex(
      sql,
      `revoke\\s+execute\\s+on\\s+${routine(name)}\\s*\\(${escaped(args)}\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*;`,
    );
    expect(created).toBeGreaterThan(-1);
    expect(revoke).toBeGreaterThan(created);
    expect(lastIndex(sql, `alter\\s+${routine(name)}`)).toBe(-1);
    const grants = matches(sql, `grant\\s[^;]*\\bon\\s+${routine(name)}[^;]*;`);
    expect(grants.every((hit) => hit.text.endsWith(' to service_role;'))).toBe(true);
    expect(grants.at(-1)!.at).toBeGreaterThan(revoke);
  });

  it('tells PostgREST to reload last', () => {
    expect(own.endsWith("notify pgrst, 'reload schema';")).toBe(true);
    expect(own.lastIndexOf('notify pgrst')).toBeGreaterThan(own.lastIndexOf('end $$;'));
  });
});
