/**
 * An audited change of a Tournament's rules is one write that checks what it read (migration 0234):
 * `repin_tournament_rules` locks the Tournament, refuses `rules_changed_since_read` when one of
 * six columns differs from what the API read, else writes the rules, the record and the stamp.
 *
 * Asserted WHOLE from the migrations, as `programme-writes.test.ts` does for 0231: a compare that
 * loses a column, a lock that goes, or a stamp that is not called cannot pass as a substring. The
 * API pins its payload keys against this body (`lastFunctionBody`). The live run (two sessions,
 * the lock waited on) is the slice's script, not a gate.
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

const SAME = (column: string) =>
  `coalesce(to_jsonb(t.${column}), 'null'::jsonb)
     is not distinct from coalesce(p_expected->'${column}', 'null'::jsonb)`;

const REPIN = `create or replace function public.repin_tournament_rules(
    p_tournament_id uuid, p_expected jsonb, p_next jsonb, p_audit jsonb
  )
  returns uuid language plpgsql security invoker set search_path = public, pg_catalog as $$
  declare
    t record;
    v_id uuid;
  begin
    select tr.event_id, tr.ruleset_code, tr.ruleset_version, tr.ruleset_config,
           tr.scoring_config_json, tr.penalty_ruleset_id, tr.penalty_ruleset_version
      into t
      from public.tournaments tr
      where tr.id = p_tournament_id
      for no key update;
    if not found then
      raise exception 'Tournament % was not found', p_tournament_id using errcode = 'P0002';
    end if;
    if not (
      ${SAME('ruleset_code')}
      and ${SAME('ruleset_version')}
      and ${SAME('ruleset_config')}
      and ${SAME('scoring_config_json')}
      and ${SAME('penalty_ruleset_id')}
      and ${SAME('penalty_ruleset_version')}
    ) then
      raise exception 'rules_changed_since_read' using errcode = 'P0001';
    end if;
    update public.tournaments
      set ruleset_code = p_next->>'ruleset_code',
          ruleset_version = p_next->>'ruleset_version',
          ruleset_config = nullif(p_next->'ruleset_config', 'null'::jsonb),
          scoring_config_json = nullif(p_next->'scoring_config_json', 'null'::jsonb),
          ruleset_content_hash = p_next->>'ruleset_content_hash',
          updated_at = now()
      where id = p_tournament_id;
    insert into public.tournament_ruleset_repins (
      event_id, tournament_id, actor_user_id, kind, from_code, from_version, to_code, to_version,
      justification, bucket_diff, ranking_compatible, placings_before, config_before, config_after,
      changes
    ) values (
      t.event_id,
      p_tournament_id,
      (p_audit->>'actor_user_id')::uuid,
      p_audit->>'kind',
      p_audit->>'from_code',
      p_audit->>'from_version',
      p_audit->>'to_code',
      p_audit->>'to_version',
      p_audit->>'justification',
      p_audit->'bucket_diff',
      (p_audit->>'ranking_compatible')::boolean,
      p_audit->'placings_before',
      p_audit->'config_before',
      p_audit->'config_after',
      p_audit->'changes'
    )
    returning id into v_id;
    perform public.stamp_match_rules(p_tournament_id);
    return v_id;
  end;
  $$`;

const COLUMNS = `alter table public.tournament_ruleset_repins
  add column kind text not null default 'ruleset' check (kind in ('ruleset', 'settings')),
  add column config_before jsonb,
  add column config_after jsonb,
  add column changes jsonb not null default '[]'::jsonb,
  alter column placings_after drop not null,
  alter column placings_after drop default;`;

const NAME = 'repin_tournament_rules';

describe("an audited change of a Tournament's rules", () => {
  const sql = allSql();
  const own = flat(
    readFileSync(
      join(__dirname, '..', 'migrations', '0234_audited_rules_write.sql'),
      'utf8',
    ).replace(/--[^\n]*/g, ''),
  );

  it('locks the row, compares six columns raw, then writes the rules, the record and the stamp', () => {
    expect(functionStatement(sql, NAME)).toBe(flat(REPIN));
  });

  it('gives the record its kind, both configs and the changes, and leaves placings_after unfilled', () => {
    expect(own).toContain(flat(COLUMNS));
    expect(own).toMatch(/comment on table public\.tournament_ruleset_repins is '/);
  });

  it('keeps placings_after nullable with no default: no later migration sets either again', () => {
    const dropped = lastIndex(sql, 'alter\\s+column\\s+placings_after\\s+drop\\s+default');
    expect(dropped).toBeGreaterThan(-1);
    // COLUMN is optional in ALTER TABLE: a later migration may leave it out.
    expect(lastIndex(sql, 'alter\\s+(?:column\\s+)?placings_after\\s+set\\s+not\\s+null')).toBe(-1);
    expect(lastIndex(sql, 'alter\\s+(?:column\\s+)?placings_after\\s+set\\s+default')).toBe(-1);
  });

  it('is called by the service role only, and no later migration widens it', () => {
    const created = lastIndex(sql, createOf(NAME));
    const revoke = lastIndex(
      sql,
      `revoke\\s+execute\\s+on\\s+${routine(NAME)}\\s*\\(uuid,\\s*jsonb,\\s*jsonb,\\s*jsonb\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*;`,
    );
    expect(created).toBeGreaterThan(-1);
    expect(revoke).toBeGreaterThan(created);
    expect(lastIndex(sql, `alter\\s+${routine(NAME)}`)).toBe(-1);
    const grants = matches(sql, `grant\\s[^;]*\\bon\\s+${routine(NAME)}[^;]*;`);
    expect(grants.map((hit) => hit.text)).toEqual([
      `grant execute on function public.${NAME}(uuid, jsonb, jsonb, jsonb) to service_role;`,
    ]);
    expect(grants.every((hit) => hit.at > revoke)).toBe(true);
  });

  // A presence check over every migration would pass on the older migrations' reloads: the
  // position is read in this file alone.
  it('tells PostgREST to reload last', () => {
    expect(own.endsWith("notify pgrst, 'reload schema';")).toBe(true);
    const notify = own.lastIndexOf("notify pgrst, 'reload schema';");
    expect(notify).toBeGreaterThan(own.lastIndexOf('create or replace function'));
    expect(notify).toBeGreaterThan(own.lastIndexOf('grant execute'));
    expect(notify).toBeGreaterThan(own.lastIndexOf('alter table'));
  });
});
