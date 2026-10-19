/**
 * The programme moves only bouts that exist (migration 0231): Generate and a cascade write their
 * bouts through two functions that UPDATE and never insert, so a bout deleted since the read is
 * not made again, and a NOT NULL column the write does not name cannot refuse it.
 *
 * Asserted WHOLE from the migrations, as `match-rules-readers.test.ts` does for 0230: a body that
 * inserts, or one granted to the public roles, cannot pass as a substring. The RLS probe
 * (`lib/programme-writes-probe.mjs`) runs both on a replayed database.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  allSql,
  createOf,
  flat,
  functionStatement,
  lastIndex,
  matches,
  routine,
} from './migration-sql';

const PLACE = `create or replace function public.programme_place_bouts(p_rows jsonb)
  returns integer language sql volatile set search_path = public, pg_catalog as $$
    with moved as (
      update public.matches m
        set scheduled_at = r.scheduled_at,
            lice_id = r.lice_id,
            planned_duration_override_minutes = null
        from jsonb_to_recordset(p_rows) as r(id uuid, scheduled_at timestamptz, lice_id uuid)
        where m.id = r.id
        returning 1
    )
    select count(*)::integer from moved;
  $$`;

const RETIME = `create or replace function public.programme_retime_bouts(p_rows jsonb)
  returns integer language sql volatile set search_path = public, pg_catalog as $$
    with moved as (
      update public.matches m
        set scheduled_at = r.scheduled_at
        from jsonb_to_recordset(p_rows) as r(id uuid, scheduled_at timestamptz)
        where m.id = r.id
          and m.status = 'scheduled'
        returning 1
    )
    select count(*)::integer from moved;
  $$`;

const FUNCTIONS = { programme_place_bouts: PLACE, programme_retime_bouts: RETIME };

describe('the programme moves only bouts that exist', () => {
  const sql = allSql();
  const own = flat(
    readFileSync(
      join(__dirname, '..', 'migrations', '0231_programme_moves_only_bouts.sql'),
      'utf8',
    ).replace(/--[^\n]*/g, ''),
  );

  it.each(Object.entries(FUNCTIONS))(
    '%s updates the bouts it is given, and inserts none',
    (name, expected) => {
      expect(functionStatement(sql, name)).toBe(flat(expected));
      expect(functionStatement(sql, name)).not.toMatch(/\binsert\b/);
    },
  );

  it.each(Object.keys(FUNCTIONS))(
    '%s is called by the service role only, and no later migration widens it',
    (name) => {
      const created = lastIndex(sql, createOf(name));
      const revoke = lastIndex(
        sql,
        `revoke\\s+execute\\s+on\\s+${routine(name)}\\s*\\(jsonb\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*;`,
      );
      expect(created).toBeGreaterThan(-1);
      expect(revoke).toBeGreaterThan(created);
      expect(lastIndex(sql, `alter\\s+${routine(name)}`)).toBe(-1);
      const grants = matches(sql, `grant\\s[^;]*\\bon\\s+${routine(name)}[^;]*;`);
      expect(grants.map((hit) => hit.text)).toEqual([
        `grant execute on function public.${name}(jsonb) to service_role;`,
      ]);
      expect(grants.every((hit) => hit.at > revoke)).toBe(true);
    },
  );

  // A presence check over every migration would pass on the older migrations' reloads: the
  // position is read in this file alone.
  it('tells PostgREST to reload after the functions it creates', () => {
    const notify = own.lastIndexOf("notify pgrst, 'reload schema';");
    expect(notify).toBeGreaterThan(own.lastIndexOf('create or replace function'));
    expect(notify).toBeGreaterThan(own.lastIndexOf('grant execute'));
  });
});
