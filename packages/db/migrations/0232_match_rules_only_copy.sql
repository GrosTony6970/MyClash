-- 0232: a bout's rules live only in its copy.
--
-- THE DEFECT. A bout said which scoring engine it is scored by in TWO places: on its own row (the
-- three columns `ruleset_code`, `ruleset_version`, `ruleset_content_hash`, 0001 and 0152) and in
-- its copy of its rules (`match_rules`, 0229). From 0230 every scoring read took the SETTINGS from
-- the copy, but the scorer and the pad's "how does this engine end a bout" still read the engine
-- off the row, and the stamp kept the two in step by writing both. Two owners of one fact.
--
-- WHAT CHANGES. The copy is the only place.
--   1. The backfill runs a last time FIRST: its only source is the three columns. A bout made
--      between two deploys with no copy takes one with its own engine pair.
--   2. `stamp_match_rules` no longer writes the three columns, and loses the branches that then
--      cannot fire: the `match_rules` join only the columns read, the arm for a bout with no copy
--      (step 3), and the arm for a bout already on the copy (the WHERE leaves it out). A bout that
--      holds the copy is still not written (each write is a change notice).
--   3. `matches.match_rules_id` is NOT NULL: a bout without a copy is refused, to every writer.
--   4. The three columns go. No view, policy, index or other function reads them (the migrations
--      were searched); plpgsql bodies are not tracked by Postgres, so the two that read them are
--      re-created (2) or dropped (5) here.
--   5. `backfill_match_rules` goes: it reads the dropped columns, and there is nothing left to
--      backfill. `build_match_rules` stays: the restore of an archive made before 0229 builds a
--      copy from the archive's own pair with it.
--   6. `ruleset_pair_held_by_a_bout(code, version)` (ruling M "Draft lock", 2026-10-19): a club
--      ruleset version is not edited in place, rolled back or unpublished while a bout holds a copy
--      naming it, its copy or, while it is not started, one it held before (a Start pressed with no
--      network may bring that one back, the offline-bout slice). The rule of 0230's
--      `card_ruleset_held_by_a_bout`. The copy's version is read as the row builder writes it ("1"
--      and "1.0" are 1.0.0, 0229): a restored archive may hold a copy at "1". A bout that never
--      starts keeps a draft it held before locked as long as its Event lives, as for cards; the
--      way out is to publish (a new version).
--   7. The copy trigger of 0229 loses its `when (new.match_rules_id is not null)`: always true now.
-- The comments of applied migrations that name the three columns (0224, 0229) are not edited:
-- an applied file never changes (migrate.mjs refuses a changed checksum).
--
-- THE DEPLOY WINDOW. The migrations run while the old API still serves: until it is replaced, its
-- scorer cannot read a bout (a hit pressed then is saved but not scored until the next action on
-- the bout), and these fail closed: making bouts (Pools, brackets, Swiss rounds, a bout added by
-- hand), the programme's Generate and shifts (its old upserts meet the NOT NULL), a reset, a
-- revert, a forfeit taken back, an offline Start, the piste board and every club-ruleset door.
-- Nobody scores during a redeploy.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- Both functions are SECURITY INVOKER (the API calls them as the service role), search_path
-- pinned, EXECUTE revoked from public, anon and authenticated BY NAME (the image grants the two
-- roles by name, 0190's header) and granted to the service role. `create or replace` keeps the
-- stamp's privileges; they are stated again after it. No table and no policy changes.

select public.backfill_match_rules();

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
          when m.match_rules_id = any (m.earlier_rules_ids) then m.earlier_rules_ids
          else m.earlier_rules_ids || m.match_rules_id
        end
    from public.phases p
    where p.id = m.phase_id
      and p.tournament_id = p_tournament_id
      and m.status = 'scheduled'
      and m.match_rules_id <> v_id;
  return v_id;
end;
$$;

revoke execute on function public.stamp_match_rules(uuid) from public, anon, authenticated;
grant execute on function public.stamp_match_rules(uuid) to service_role;

alter table public.matches alter column match_rules_id set not null;

alter table public.matches
  drop column if exists ruleset_code,
  drop column if exists ruleset_version,
  drop column if exists ruleset_content_hash;

drop function if exists public.backfill_match_rules();

create or replace function public.ruleset_pair_held_by_a_bout(p_code text, p_version text)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.match_rules r
    join public.matches m
      on m.match_rules_id = r.id
        or (m.status = 'scheduled' and r.id = any (m.earlier_rules_ids))
    where r.ruleset_code = p_code
      and (case when coalesce(r.ruleset_version, '') in ('', '1', '1.0') then '1.0.0'
                else r.ruleset_version end) = p_version
  );
$$;

comment on function public.ruleset_pair_held_by_a_bout(text, text) is
  'True when a bout holds a copy of its rules naming this ruleset version (its copy, or one it held before while it is not started): the version is not edited in place.';

revoke execute on function public.ruleset_pair_held_by_a_bout(text, text) from public, anon, authenticated;
grant execute on function public.ruleset_pair_held_by_a_bout(text, text) to service_role;

drop trigger if exists matches_rules_of_its_tournament on public.matches;

create trigger matches_rules_of_its_tournament
  after insert or update of match_rules_id, phase_id on public.matches
  for each row
  execute function public.match_rules_of_its_tournament();

NOTIFY pgrst, 'reload schema';
