-- 0229: a Match carries its own copy of its rules.
--
-- THE DEFECT. Bout 4 of Pool 2 ended 5-3 at the cap of 5. The organiser raises the cap to 7. Later
-- the desk corrects one hit of bout 4: the server decides it again with the Tournament's settings of
-- NOW, cap 7, and bout 4 is no longer over. A Match row carries its engine (`ruleset_code`,
-- `ruleset_version`, `ruleset_content_hash`), but every scoring reader takes the SETTINGS live from
-- its Tournament. Operator rulings (2026-10-17): a bout keeps everything it started under (the
-- engine, the settings, the card rules); a finished bout keeps the rules it ended under; the tables,
-- stats and TV follow the Tournament.
--
-- WHAT CHANGES. `match_rules`: one immutable copy of a Tournament's rules (the engine pair, its
-- `ruleset_config`, from `scoring_config_json` only `afterblowMode` and `buttons` (ruling "Buttons":
-- buttons are rules), the card rules pin resolved Tournament → Event → built-in, the content hash
-- as a label). A Match points at one (`matches.match_rules_id`) and keeps the ones it held before
-- (`earlier_rules_ids`). One writer of the copies, `stamp_match_rules(tournament)`: it builds the
-- Tournament's copy of now, or finds the one already made (`UNIQUE (tournament_id, digest)`), and
-- points every Match NOT STARTED of the Tournament at it; a Match that started keeps its copy. Until
-- the foundation's last commit it also writes the three old columns of those Matches from the copy.
-- `build_match_rules` is its row builder, called by the backfill below and by the restore of an
-- archive made before this migration (ruling "Old archives"): a copy of a Tournament's settings
-- with a given engine pair.
--   - The race: two stamps of one Tournament, each reading the rules of its moment. A stamp locks
--     the Tournament row (FOR NO KEY UPDATE, which a new phase's or bout's foreign key check does
--     not wait on), so the second waits for the first, then reads the rules of after it and
--     writes last: a slower stamp cannot write an older copy back over a newer one.
--   - A copy never changes: the pad keeps it for good. The one change allowed is the card pin set
--     to NULL with nothing else moved, which is how Postgres applies `ON DELETE SET NULL` when an
--     organisation or a card ruleset is deleted; a NULL pin reads as the built-in.
--   - A Match points only at a copy of its own Tournament (ruling "A direct bout write"): a trigger
--     refuses another Tournament's copy to every writer. AFTER the row is written, so RLS refuses a
--     writer without authority first and the trigger tells it nothing (0224's lesson).
--   - The backfill (`backfill_match_rules`, run at the end and again by the foundation's later
--     migrations) gives every Match with no copy one: one per (Tournament, the Match's own engine
--     pair and hash) with the Tournament's current settings, so the first stamp after the deploy
--     moves no Match.
--   - `digest`: sha256 of the eight rule columns as one jsonb text (jsonb orders its keys), never
--     the id or the date. A number spelled `1.0` and `1` digests apart: one copy more, harmless.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- RLS on `match_rules`: a copy is read by whoever reads its Tournament (one SELECT policy, through
-- the Tournament's own). Only the API writes it: INSERT, UPDATE and DELETE revoked from `anon` and
-- `authenticated` (the 0216 pattern). The two functions are SECURITY INVOKER (the API calls them as
-- the service role), search_path pinned, EXECUTE revoked from public, anon and authenticated by
-- name (the image grants them by name, 0190's header) and granted to the service role; the
-- backfill is granted to no role, the service role included (a migration runs it). The trigger
-- on `matches` is SECURITY DEFINER: it reads a copy and a phase whatever the writer may read.

create table if not exists public.match_rules (
  id                      uuid primary key default gen_random_uuid(),
  tournament_id           uuid not null references public.tournaments (id) on delete cascade,
  ruleset_code            text not null,
  ruleset_version         text not null,
  ruleset_content_hash    text,
  ruleset_config          jsonb not null,
  scoring_config_json     jsonb not null,
  penalty_ruleset_id      uuid references public.penalty_rulesets (id) on delete set null,
  penalty_ruleset_version text,
  digest                  text not null,
  created_at              timestamptz not null default now(),
  constraint match_rules_one_per_digest unique (tournament_id, digest),
  constraint match_rules_ruleset_config_object check (jsonb_typeof(ruleset_config) = 'object'),
  constraint match_rules_scoring_config_object check (jsonb_typeof(scoring_config_json) = 'object')
);

alter table public.match_rules enable row level security;

drop policy if exists "match_rules_read_with_tournament" on public.match_rules;
create policy "match_rules_read_with_tournament" on public.match_rules
  for select
  using (exists (select 1 from public.tournaments t where t.id = match_rules.tournament_id));

revoke insert, update, delete on public.match_rules from anon, authenticated;

alter table public.matches
  add column if not exists match_rules_id uuid references public.match_rules (id),
  add column if not exists earlier_rules_ids uuid[] not null default '{}';

create index if not exists matches_match_rules_id_idx on public.matches (match_rules_id);

create or replace function public.match_rules_never_change()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.penalty_ruleset_id is null
    and (to_jsonb(new) - 'penalty_ruleset_id') = (to_jsonb(old) - 'penalty_ruleset_id')
  then
    return new;
  end if;
  raise exception 'A copy of a Match''s rules never changes'
    using errcode = 'check_violation';
end;
$$;

comment on function public.match_rules_never_change() is
  'BEFORE UPDATE trigger on match_rules: refuses every change but the card pin set to NULL with nothing else moved (ON DELETE SET NULL).';

create or replace function public.build_match_rules(
  p_tournament_id uuid,
  p_code          text,
  p_version       text,
  p_hash          text
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  t record;
  pin_id uuid;
  pin_version text;
  scoring jsonb;
  v_version text;
  rules jsonb;
  v_digest text;
  v_id uuid;
begin
  select tr.event_id, tr.ruleset_config, tr.scoring_config_json, tr.penalty_ruleset_id,
         tr.penalty_ruleset_version
    into t
    from public.tournaments tr
    where tr.id = p_tournament_id;
  if not found then
    raise exception 'Tournament % was not found', p_tournament_id
      using errcode = 'no_data_found';
  end if;
  if t.penalty_ruleset_id is not null then
    pin_id := t.penalty_ruleset_id;
    pin_version := t.penalty_ruleset_version;
  else
    select e.penalty_ruleset_id, e.penalty_ruleset_version
      into pin_id, pin_version
      from public.events e
      where e.id = t.event_id;
    if pin_id is null then
      select pr.id, pr.version
        into pin_id, pin_version
        from public.penalty_rulesets pr
        where pr.built_in and pr.owner_organization_id is null
        limit 1;
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
    'tournament_id', p_tournament_id,
    'ruleset_code', p_code,
    'ruleset_version', v_version,
    'ruleset_content_hash', p_hash,
    'ruleset_config', coalesce(t.ruleset_config, '{}'::jsonb),
    'scoring_config_json', scoring,
    'penalty_ruleset_id', pin_id,
    'penalty_ruleset_version', pin_version
  );
  v_digest := encode(sha256(convert_to(rules::text, 'UTF8')), 'hex');
  insert into public.match_rules (
    tournament_id, ruleset_code, ruleset_version, ruleset_content_hash, ruleset_config,
    scoring_config_json, penalty_ruleset_id, penalty_ruleset_version, digest
  )
  values (
    p_tournament_id, p_code, v_version, p_hash, coalesce(t.ruleset_config, '{}'::jsonb),
    scoring, pin_id, pin_version, v_digest
  )
  on conflict (tournament_id, digest) do nothing
  returning id into v_id;
  if v_id is null then
    select r.id into v_id
      from public.match_rules r
      where r.tournament_id = p_tournament_id and r.digest = v_digest;
  end if;
  return v_id;
end;
$$;

comment on function public.build_match_rules(uuid, text, text, text) is
  'The copy of a Tournament''s rules of now with the engine pair given (version "1" read as 1.0.0), made or found by its digest; the card pin resolved Tournament, Event, built-in.';

create or replace function public.stamp_match_rules(p_tournament_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  t record;
  v_id uuid;
begin
  select tr.ruleset_code, tr.ruleset_version, tr.ruleset_content_hash
    into t
    from public.tournaments tr
    where tr.id = p_tournament_id
    for no key update;
  if not found then
    raise exception 'Tournament % was not found', p_tournament_id
      using errcode = 'no_data_found';
  end if;
  if coalesce(t.ruleset_code, '') = '' then
    raise exception 'The Tournament has no ruleset pair to stamp on its bouts'
      using errcode = 'check_violation';
  end if;
  v_id := public.build_match_rules(
    p_tournament_id, t.ruleset_code, t.ruleset_version, t.ruleset_content_hash
  );
  update public.matches m
    set match_rules_id = v_id,
        earlier_rules_ids = case
          when m.match_rules_id is null
            or m.match_rules_id = v_id
            or m.match_rules_id = any (m.earlier_rules_ids)
          then m.earlier_rules_ids
          else m.earlier_rules_ids || m.match_rules_id
        end,
        ruleset_code = r.ruleset_code,
        ruleset_version = r.ruleset_version,
        ruleset_content_hash = r.ruleset_content_hash
    from public.match_rules r, public.phases p
    where r.id = v_id
      and p.id = m.phase_id
      and p.tournament_id = p_tournament_id
      and m.status = 'scheduled'
      and (
        m.match_rules_id is distinct from v_id
        or m.ruleset_code is distinct from r.ruleset_code
        or m.ruleset_version is distinct from r.ruleset_version
        or m.ruleset_content_hash is distinct from r.ruleset_content_hash
      );
  return v_id;
end;
$$;

comment on function public.stamp_match_rules(uuid) is
  'The one writer of the copies: points every Match not started of the Tournament at its copy of now (kept as earlier the one it held), and returns its id. A started Match keeps its copy.';

create or replace function public.match_rules_of_its_tournament()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if not exists (
    select 1
    from public.match_rules r
    join public.phases p on p.tournament_id = r.tournament_id
    where r.id = new.match_rules_id
      and p.id = new.phase_id
  ) then
    raise exception 'A bout takes only a copy of its own Tournament''s rules'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.match_rules_of_its_tournament() is
  'AFTER INSERT/UPDATE trigger on matches: refuses, to every writer, a match_rules_id that is not a copy of the Match''s own Tournament.';

revoke execute on function public.match_rules_never_change() from public, anon, authenticated;
revoke execute on function public.build_match_rules(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.stamp_match_rules(uuid) from public, anon, authenticated;
revoke execute on function public.match_rules_of_its_tournament() from public, anon, authenticated;
grant execute on function public.build_match_rules(uuid, text, text, text) to service_role;
grant execute on function public.stamp_match_rules(uuid) to service_role;

drop trigger if exists match_rules_never_change on public.match_rules;
drop trigger if exists matches_rules_of_its_tournament on public.matches;

create trigger match_rules_never_change
  before update on public.match_rules
  for each row
  execute function public.match_rules_never_change();

create trigger matches_rules_of_its_tournament
  after insert or update of match_rules_id, phase_id on public.matches
  for each row
  when (new.match_rules_id is not null)
  execute function public.match_rules_of_its_tournament();

-- The backfill: every Match with no copy takes one of its Tournament's settings with its own engine
-- pair. Run here, and again by the later migrations of the foundation (a Match made between two
-- deploys holds none). No role may call it: only a migration runs it.
create or replace function public.backfill_match_rules()
returns integer
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  g record;
  v_id uuid;
  moved integer := 0;
  n integer;
begin
  for g in
    select distinct p.tournament_id, m.ruleset_code, m.ruleset_version, m.ruleset_content_hash
    from public.matches m
    join public.phases p on p.id = m.phase_id
    where m.match_rules_id is null
  loop
    v_id := public.build_match_rules(
      g.tournament_id, g.ruleset_code, g.ruleset_version, g.ruleset_content_hash
    );
    update public.matches m
      set match_rules_id = v_id
      from public.phases p
      where p.id = m.phase_id
        and p.tournament_id = g.tournament_id
        and m.match_rules_id is null
        and m.ruleset_code is not distinct from g.ruleset_code
        and m.ruleset_version is not distinct from g.ruleset_version
        and m.ruleset_content_hash is not distinct from g.ruleset_content_hash;
    get diagnostics n = row_count;
    moved := moved + n;
  end loop;
  return moved;
end;
$$;

comment on function public.backfill_match_rules() is
  'Gives every Match with no copy one of its Tournament''s settings of now with the Match''s own engine pair and hash; answers how many it gave. Run by migrations only.';

revoke execute on function public.backfill_match_rules() from public, anon, authenticated, service_role;

select public.backfill_match_rules();
