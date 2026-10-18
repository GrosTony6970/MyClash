/**
 * The scoring readers of a bout read its own copy of its rules (migration 0230, the foundation
 * slice's commit 3). The migration runs the backfill again FIRST, so no reader meets a bout made
 * between two deploys with no copy; and it gives the card edit guard one question, whether a bout
 * holds a copy pinning a card ruleset (its copy or one it held before).
 *
 * Asserted WHOLE from the migrations, as `match-rules.test.ts` does for 0229: a function that
 * counts every copy, dead ones included, or one granted to the public roles cannot pass as a
 * substring. The RLS probe (check 11, `lib/match-rules-probe.mjs`) runs it on a replayed database.
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

const HELD = `create or replace function public.card_ruleset_held_by_a_bout(p_ruleset_id uuid)
  returns boolean language sql stable security invoker set search_path = public, pg_catalog as $$
    select exists (
      select 1 from public.match_rules r
      join public.matches m on m.match_rules_id = r.id
        or (m.status = 'scheduled' and r.id = any (m.earlier_rules_ids))
      where r.penalty_ruleset_id = p_ruleset_id
    );
  $$`;

describe("the readers of a bout's own copy of its rules", () => {
  const sql = allSql();
  const own = flat(
    readFileSync(
      join(__dirname, '..', 'migrations', '0230_match_rules_readers.sql'),
      'utf8',
    ).replace(/--[^\n]*/g, ''),
  );

  it('runs the backfill again before anything else of its own', () => {
    expect(own.startsWith('select public.backfill_match_rules();')).toBe(true);
  });

  it('asks whether a bout holds a copy pinning a card ruleset: its copy, or an earlier one while it is not started', () => {
    expect(functionStatement(sql, 'card_ruleset_held_by_a_bout')).toBe(flat(HELD));
  });

  it('is called by the service role only, and no later migration widens it', () => {
    const name = 'card_ruleset_held_by_a_bout';
    const created = lastIndex(sql, createOf(name));
    const revoke = lastIndex(
      sql,
      `revoke\\s+execute\\s+on\\s+${routine(name)}\\s*\\(uuid\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*;`,
    );
    expect(created).toBeGreaterThan(-1);
    expect(revoke).toBeGreaterThan(created);
    expect(lastIndex(sql, `alter\\s+${routine(name)}`)).toBe(-1);
    const grants = matches(sql, `grant\\s[^;]*\\bon\\s+${routine(name)}[^;]*;`);
    expect(grants.map((hit) => hit.text)).toEqual([
      'grant execute on function public.card_ruleset_held_by_a_bout(uuid) to service_role;',
    ]);
    expect(grants.every((hit) => hit.at > revoke)).toBe(true);
  });
});
