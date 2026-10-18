/**
 * A Match carries its own copy of its rules (migration 0229, the foundation slice; rulings "What a
 * bout keeps", "Buttons", "A direct bout write").
 *
 * This reads the migrations in order and asserts each function and trigger WHOLE, and the table's
 * shape, its read policy and its write grants, so a stamp that moves a started bout, a digest that
 * leaves a column out, a card pin resolved another way, a copy that may change, a trigger turned
 * BEFORE (which answers a writer RLS would refuse) or one that skips a writer cannot pass as a
 * substring. The RLS probe (check 11, `lib/match-rules-probe.mjs`) runs the same rules on a
 * replayed database.
 */
import { describe, it, expect } from 'vitest';
import {
  allSql,
  createOf,
  flat,
  functionStatement,
  lastIndex,
  matches,
  routine,
  triggerStatement,
} from './migration-sql';

const INVOKER = 'security invoker set search_path = public, pg_catalog as $$';

const EXPECTED_FUNCTIONS: Record<string, string> = {
  match_rules_never_change: `create or replace function public.match_rules_never_change()
    returns trigger language plpgsql set search_path = public, pg_catalog as $$
    begin
      if new.penalty_ruleset_id is null
        and (to_jsonb(new) - 'penalty_ruleset_id') = (to_jsonb(old) - 'penalty_ruleset_id')
      then return new; end if;
      raise exception 'A copy of a Match''s rules never changes' using errcode = 'check_violation';
    end; $$`,
  build_match_rules: `create or replace function public.build_match_rules(
      p_tournament_id uuid, p_code text, p_version text, p_hash text)
    returns uuid language plpgsql ${INVOKER}
    declare t record; pin_id uuid; pin_version text; scoring jsonb; v_version text; rules jsonb;
      v_digest text; v_id uuid;
    begin
      select tr.event_id, tr.ruleset_config, tr.scoring_config_json, tr.penalty_ruleset_id,
             tr.penalty_ruleset_version
        into t from public.tournaments tr where tr.id = p_tournament_id;
      if not found then
        raise exception 'Tournament % was not found', p_tournament_id using errcode = 'no_data_found';
      end if;
      if t.penalty_ruleset_id is not null then
        pin_id := t.penalty_ruleset_id; pin_version := t.penalty_ruleset_version;
      else
        select e.penalty_ruleset_id, e.penalty_ruleset_version into pin_id, pin_version
          from public.events e where e.id = t.event_id;
        if pin_id is null then
          select pr.id, pr.version into pin_id, pin_version from public.penalty_rulesets pr
            where pr.built_in and pr.owner_organization_id is null limit 1;
        end if;
      end if;
      scoring := coalesce(t.scoring_config_json, '{}'::jsonb);
      scoring := (case when scoring ? 'afterblowMode'
                    then jsonb_build_object('afterblowMode', scoring -> 'afterblowMode')
                    else '{}'::jsonb end)
              || (case when scoring ? 'buttons'
                    then jsonb_build_object('buttons', scoring -> 'buttons')
                    else '{}'::jsonb end);
      v_version := case when coalesce(p_version, '') in ('', '1', '1.0') then '1.0.0' else p_version end;
      rules := jsonb_build_object(
        'tournament_id', p_tournament_id, 'ruleset_code', p_code, 'ruleset_version', v_version,
        'ruleset_content_hash', p_hash, 'ruleset_config', coalesce(t.ruleset_config, '{}'::jsonb),
        'scoring_config_json', scoring, 'penalty_ruleset_id', pin_id,
        'penalty_ruleset_version', pin_version);
      v_digest := encode(sha256(convert_to(rules::text, 'UTF8')), 'hex');
      insert into public.match_rules (
        tournament_id, ruleset_code, ruleset_version, ruleset_content_hash, ruleset_config,
        scoring_config_json, penalty_ruleset_id, penalty_ruleset_version, digest)
      values (
        p_tournament_id, p_code, v_version, p_hash, coalesce(t.ruleset_config, '{}'::jsonb),
        scoring, pin_id, pin_version, v_digest)
      on conflict (tournament_id, digest) do nothing
      returning id into v_id;
      if v_id is null then
        select r.id into v_id from public.match_rules r
          where r.tournament_id = p_tournament_id and r.digest = v_digest;
      end if;
      return v_id;
    end; $$`,
  stamp_match_rules: `create or replace function public.stamp_match_rules(p_tournament_id uuid)
    returns uuid language plpgsql ${INVOKER}
    declare t record; v_id uuid;
    begin
      select tr.ruleset_code, tr.ruleset_version, tr.ruleset_content_hash into t
        from public.tournaments tr where tr.id = p_tournament_id for no key update;
      if not found then
        raise exception 'Tournament % was not found', p_tournament_id using errcode = 'no_data_found';
      end if;
      if coalesce(t.ruleset_code, '') = '' then
        raise exception 'The Tournament has no ruleset pair to stamp on its bouts'
          using errcode = 'check_violation';
      end if;
      v_id := public.build_match_rules(
        p_tournament_id, t.ruleset_code, t.ruleset_version, t.ruleset_content_hash);
      update public.matches m
        set match_rules_id = v_id,
            earlier_rules_ids = case
              when m.match_rules_id is null or m.match_rules_id = v_id
                or m.match_rules_id = any (m.earlier_rules_ids)
              then m.earlier_rules_ids
              else m.earlier_rules_ids || m.match_rules_id
            end,
            ruleset_code = r.ruleset_code,
            ruleset_version = r.ruleset_version,
            ruleset_content_hash = r.ruleset_content_hash
        from public.match_rules r, public.phases p
        where r.id = v_id and p.id = m.phase_id and p.tournament_id = p_tournament_id
          and m.status = 'scheduled'
          and (m.match_rules_id is distinct from v_id
            or m.ruleset_code is distinct from r.ruleset_code
            or m.ruleset_version is distinct from r.ruleset_version
            or m.ruleset_content_hash is distinct from r.ruleset_content_hash);
      return v_id;
    end; $$`,
  match_rules_of_its_tournament: `create or replace function public.match_rules_of_its_tournament()
    returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
    begin
      if not exists (
        select 1 from public.match_rules r
        join public.phases p on p.tournament_id = r.tournament_id
        where r.id = new.match_rules_id and p.id = new.phase_id
      ) then
        raise exception 'A bout takes only a copy of its own Tournament''s rules'
          using errcode = 'check_violation';
      end if;
      return new;
    end; $$`,
  backfill_match_rules: `create or replace function public.backfill_match_rules()
    returns integer language plpgsql ${INVOKER}
    declare g record; v_id uuid; moved integer := 0; n integer;
    begin
      for g in
        select distinct p.tournament_id, m.ruleset_code, m.ruleset_version, m.ruleset_content_hash
        from public.matches m join public.phases p on p.id = m.phase_id
        where m.match_rules_id is null
      loop
        v_id := public.build_match_rules(
          g.tournament_id, g.ruleset_code, g.ruleset_version, g.ruleset_content_hash);
        update public.matches m set match_rules_id = v_id
          from public.phases p
          where p.id = m.phase_id and p.tournament_id = g.tournament_id
            and m.match_rules_id is null
            and m.ruleset_code is not distinct from g.ruleset_code
            and m.ruleset_version is not distinct from g.ruleset_version
            and m.ruleset_content_hash is not distinct from g.ruleset_content_hash;
        get diagnostics n = row_count;
        moved := moved + n;
      end loop;
      return moved;
    end; $$`,
};

/** Who may EXECUTE each function, by the migrations' last word: the service role, or no one. */
const GRANTS: Record<string, { revoked: string; granted: string[] }> = {
  match_rules_never_change: { revoked: 'public, anon, authenticated', granted: [] },
  match_rules_of_its_tournament: { revoked: 'public, anon, authenticated', granted: [] },
  build_match_rules: {
    revoked: 'public, anon, authenticated',
    granted: [
      'grant execute on function public.build_match_rules(uuid, text, text, text) to service_role;',
    ],
  },
  stamp_match_rules: {
    revoked: 'public, anon, authenticated',
    granted: ['grant execute on function public.stamp_match_rules(uuid) to service_role;'],
  },
  backfill_match_rules: { revoked: 'public, anon, authenticated, service_role', granted: [] },
};

const EXPECTED_TRIGGERS: Record<string, string> = {
  match_rules_never_change:
    'create trigger match_rules_never_change before update on public.match_rules for each row ' +
    'execute function public.match_rules_never_change();',
  matches_rules_of_its_tournament:
    'create trigger matches_rules_of_its_tournament after insert or update of match_rules_id, ' +
    'phase_id on public.matches for each row when (new.match_rules_id is not null) ' +
    'execute function public.match_rules_of_its_tournament();',
};

const TABLE = `create table if not exists public.match_rules (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  ruleset_code text not null, ruleset_version text not null, ruleset_content_hash text,
  ruleset_config jsonb not null, scoring_config_json jsonb not null,
  penalty_ruleset_id uuid references public.penalty_rulesets (id) on delete set null,
  penalty_ruleset_version text, digest text not null,
  created_at timestamptz not null default now(),
  constraint match_rules_one_per_digest unique (tournament_id, digest),
  constraint match_rules_ruleset_config_object check (jsonb_typeof(ruleset_config) = 'object'),
  constraint match_rules_scoring_config_object check (jsonb_typeof(scoring_config_json) = 'object')
);`;

describe("a Match's own copy of its rules", () => {
  const sql = allSql();
  const statement = (pattern: string) => matches(sql, pattern).at(-1)?.text;

  it('keeps the table as built: the eight rule columns, one copy per digest, objects only', () => {
    expect(
      statement('create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?public\\.match_rules\\b[^;]*;'),
    ).toBe(flat(TABLE));
    expect(
      lastIndex(sql, 'alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:public\\.)?match_rules\\b'),
    ).toBe(
      lastIndex(
        sql,
        'alter\\s+table\\s+public\\.match_rules\\s+enable\\s+row\\s+level\\s+security',
      ),
    );
  });

  it('is read with its Tournament, and written by the API only', () => {
    expect(
      statement('create\\s+policy\\s+match_rules_[a-z_]+\\s+on\\s+public\\.match_rules\\b[^;]*;'),
    ).toBe(
      flat(`create policy match_rules_read_with_tournament on public.match_rules for select
        using (exists (select 1 from public.tournaments t where t.id = match_rules.tournament_id));`),
    );
    expect(
      matches(sql, 'create\\s+policy\\s+[^;]*\\bon\\s+(?:public\\.)?match_rules\\b'),
    ).toHaveLength(1);
    const revoked = lastIndex(
      sql,
      'revoke\\s+insert,\\s*update,\\s*delete\\s+on\\s+public\\.match_rules\\s+from\\s+anon,\\s*authenticated\\s*;',
    );
    expect(revoked).toBeGreaterThan(-1);
    expect(
      lastIndex(
        sql,
        'grant\\s+[^;]*\\b(?:insert|update|delete|all)\\b[^;]*\\bon\\s+(?:table\\s+)?(?:public\\.)?(?:[a-z_]+,\\s*)*match_rules\\b',
      ),
    ).toBeLessThan(revoked);
  });

  it('gives a Match a pointer to its copy and the list of the ones it held, indexed', () => {
    expect(
      statement('alter\\s+table\\s+public\\.matches\\s+add\\s+column[^;]*match_rules_id[^;]*;'),
    ).toBe(
      flat(`alter table public.matches
        add column if not exists match_rules_id uuid references public.match_rules (id),
        add column if not exists earlier_rules_ids uuid[] not null default '{}';`),
    );
    expect(
      statement('create\\s+index\\s+[^;]*\\bon\\s+public\\.matches\\s*\\(match_rules_id\\)[^;]*;'),
    ).toBe(
      'create index if not exists matches_match_rules_id_idx on public.matches (match_rules_id);',
    );
  });

  it.each(Object.entries(EXPECTED_FUNCTIONS))(
    '%s holds the ruled rule, whole',
    (name, expected) => {
      expect(functionStatement(sql, name)).toBe(flat(expected));
    },
  );

  it.each(Object.entries(GRANTS))(
    '%s is called by whom it is granted to, and no later migration widens it',
    (name, { revoked, granted }) => {
      const created = lastIndex(sql, createOf(name));
      const revoke = lastIndex(
        sql,
        `revoke\\s+execute\\s+on\\s+${routine(name)}\\s*\\([^)]*\\)\\s+from\\s+${revoked.replace(/, /g, '\\s*,\\s*')}\\s*;`,
      );
      expect(created).toBeGreaterThan(-1);
      expect(revoke).toBeGreaterThan(created);
      expect(lastIndex(sql, `alter\\s+${routine(name)}`)).toBe(-1);
      const grants = matches(sql, `grant\\s[^;]*\\bon\\s+${routine(name)}[^;]*;`);
      expect(grants.map((hit) => hit.text)).toEqual(granted.map(flat));
      expect(grants.every((hit) => hit.at > revoke)).toBe(true);
      expect(
        lastIndex(
          sql,
          `drop\\s+(?:function|routine)\\s+(?:if\\s+exists\\s+)?(?:public\\.)?${name}\\b`,
        ),
      ).toBeLessThan(created);
    },
  );

  it.each(Object.entries(EXPECTED_TRIGGERS))('%s fires as built', (name, expected) => {
    expect(triggerStatement(sql, name)).toBe(flat(expected));
    const created = lastIndex(sql, `create\\s+(?:or\\s+replace\\s+)?trigger\\s+${name}\\b`);
    expect(lastIndex(sql, `drop\\s+trigger\\s+(?:if\\s+exists\\s+)?${name}\\b`)).toBeLessThan(
      created,
    );
    const switched = `(?:disable|enable\\s+(?:replica|always))\\s+trigger\\s+(?:${name}|all|user)\\b`;
    expect(lastIndex(sql, switched)).toBe(-1);
  });

  it('runs the backfill once its functions and the pointer exist', () => {
    const ran = lastIndex(sql, 'select\\s+public\\.backfill_match_rules\\(\\)\\s*;');
    expect(ran).toBeGreaterThan(lastIndex(sql, createOf('backfill_match_rules')));
    expect(ran).toBeGreaterThan(lastIndex(sql, createOf('build_match_rules')));
    expect(ran).toBeGreaterThan(
      lastIndex(sql, 'add\\s+column\\s+if\\s+not\\s+exists\\s+match_rules_id'),
    );
  });
});
