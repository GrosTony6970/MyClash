/**
 * A bout's rules live only in its copy (migration 0232, the foundation slice's last commit): the
 * three engine columns of `matches` go, every bout holds a copy, and a club ruleset version a bout
 * holds is locked as a card ruleset is (ruling M "Draft lock").
 *
 * The order inside 0232 is the point: the backfill reads the three columns, so it runs before
 * they go; the stamp is made again without them before they go (a plpgsql body is not tracked by
 * Postgres: left as it was, every stamp would fail at its first call); the backfill is dropped
 * after (it reads them). Asserted on 0232's own text, positions compared, and on all the
 * migrations for the last word on each object. The RLS probe (check 11) runs it live.
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

const HELD = `create or replace function public.ruleset_pair_held_by_a_bout(p_code text, p_version text)
  returns boolean language sql stable security invoker set search_path = public, pg_catalog as $$
    select exists (
      select 1 from public.match_rules r
      join public.matches m on m.match_rules_id = r.id
        or (m.status = 'scheduled' and r.id = any (m.earlier_rules_ids))
      where r.ruleset_code = p_code
        and (case when coalesce(r.ruleset_version, '') in ('', '1', '1.0') then '1.0.0'
                  else r.ruleset_version end) = p_version
    );
  $$`;

const OLD_COLUMNS = ['ruleset_code', 'ruleset_version', 'ruleset_content_hash'];

describe("a bout's rules live only in its copy", () => {
  const sql = allSql();
  const own = flat(
    readFileSync(
      join(__dirname, '..', 'migrations', '0232_match_rules_only_copy.sql'),
      'utf8',
    ).replace(/--[^\n]*/g, ''),
  );
  const at = (pattern: string) => {
    const hit = new RegExp(pattern, 'i').exec(own);
    expect(hit, `0232 has no ${pattern}`).not.toBeNull();
    return hit!.index;
  };

  it('runs the backfill, makes the stamp again, then sets NOT NULL, drops the columns, drops the backfill', () => {
    const backfill = at('select public\\.backfill_match_rules\\(\\);');
    const stamp = at(createOf('stamp_match_rules'));
    const notNull = at('alter table public\\.matches alter column match_rules_id set not null;');
    const dropColumns = at(
      'alter table public\\.matches drop column if exists ruleset_code, drop column if exists ruleset_version, drop column if exists ruleset_content_hash;',
    );
    const dropBackfill = at('drop function if exists public\\.backfill_match_rules\\(\\);');
    expect(backfill).toBe(0);
    expect(backfill).toBeLessThan(stamp);
    expect(stamp).toBeLessThan(notNull);
    expect(notNull).toBeLessThan(dropColumns);
    expect(dropColumns).toBeLessThan(dropBackfill);
  });

  it('leaves every bout pointing at a copy, and the three columns gone for good', () => {
    const notNull = lastIndex(
      sql,
      'alter\\s+table\\s+public\\.matches\\s+alter\\s+column\\s+match_rules_id\\s+set\\s+not\\s+null',
    );
    expect(notNull).toBeGreaterThan(-1);
    expect(lastIndex(sql, 'alter\\s+column\\s+match_rules_id\\s+drop\\s+not\\s+null')).toBeLessThan(
      notNull,
    );
    const dropped = lastIndex(
      sql,
      'alter\\s+table\\s+public\\.matches\\s+drop\\s+column\\s+if\\s+exists\\s+ruleset_code\\b',
    );
    expect(dropped).toBeGreaterThan(notNull);
    for (const column of OLD_COLUMNS) {
      expect(
        lastIndex(
          sql,
          `alter\\s+table\\s+(?:public\\.)?matches\\b[^;]*add\\s+column[^;]*\\b${column}\\b`,
        ),
        column,
      ).toBeLessThan(dropped);
    }
  });

  it('drops the backfill after its last run, and never makes it again', () => {
    const dropped = lastIndex(
      sql,
      'drop\\s+function\\s+(?:if\\s+exists\\s+)?(?:public\\.)?backfill_match_rules\\b',
    );
    expect(dropped).toBeGreaterThan(
      lastIndex(sql, 'select\\s+public\\.backfill_match_rules\\(\\)'),
    );
    expect(lastIndex(sql, createOf('backfill_match_rules'))).toBeLessThan(dropped);
  });

  it('asks whether a bout holds a copy naming a ruleset version, read as the row builder writes it', () => {
    expect(functionStatement(sql, 'ruleset_pair_held_by_a_bout')).toBe(flat(HELD));
  });

  it('lets the service role only ask it, and no later migration widens it', () => {
    const name = 'ruleset_pair_held_by_a_bout';
    const created = lastIndex(sql, createOf(name));
    const revoke = lastIndex(
      sql,
      `revoke\\s+execute\\s+on\\s+${routine(name)}\\s*\\(text,\\s*text\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*;`,
    );
    expect(created).toBeGreaterThan(-1);
    expect(revoke).toBeGreaterThan(created);
    expect(lastIndex(sql, `alter\\s+${routine(name)}`)).toBe(-1);
    const grants = matches(sql, `grant\\s[^;]*\\bon\\s+${routine(name)}[^;]*;`);
    expect(grants.map((hit) => hit.text)).toEqual([
      'grant execute on function public.ruleset_pair_held_by_a_bout(text, text) to service_role;',
    ]);
    expect(grants.every((hit) => hit.at > revoke)).toBe(true);
  });

  // A presence check over every migration would pass on the older migrations' reloads.
  it('tells PostgREST to reload after everything it changes', () => {
    const notify = own.lastIndexOf("notify pgrst, 'reload schema';");
    expect(notify).toBeGreaterThan(own.lastIndexOf('create trigger'));
    expect(notify).toBeGreaterThan(own.lastIndexOf('create or replace function'));
    expect(notify).toBeGreaterThan(own.lastIndexOf('drop column'));
  });
});
