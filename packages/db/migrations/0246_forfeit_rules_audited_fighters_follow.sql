-- 0246: a Tournament's forfeit rules change through the audited save, and its Fighters follow
-- (the audited settings change, commit 5b; operator rulings 142-146, 149, 150, 157-160).
--
-- THE DEFECT. Once a Tournament has started, its forfeit rules are refused outright
-- (`forfeit_rules_locked`, ruling 73): an organiser who must correct "disqualify after" mid-event
-- has no door. The audited change (0234's `repin_tournament_rules`) neither compares nor writes
-- `forfeit_rules`, and a Fighter's status rule lives inside `settle_fighter_status` alone, so the
-- API cannot ask "whose status would this change move?" without a second copy of the rule.
--
-- WHAT CHANGES.
--   1. `fighter_status_under(p_registration, p_rules, p_entry)` is the ONE owner of the status
--      rule, taken out of 0242's `settle_fighter_status` unchanged: the status a Fighter has under
--      `p_rules` and the hand `p_entry`, and `crossed_at`, WHEN the cause that puts them out
--      happened (ruling 146: of two Fighters out on one bout, the first to cross forfeits it). One
--      set of filtered rows feeds both: the live forfeits whose outcome put the Fighter out, the
--      N-th counted forfeit (by `created_at`, then `id`), the 1st and the 2nd live black card (by
--      `recorded_at`, then `id`) when the rules say it puts out, and a confirmed second-card review
--      still standing. `crossed_at` is the earliest of the causes that hold; NULL for a Fighter in,
--      and for one out by the organiser's hand alone (`entry_status` holds no time; such a Fighter is
--      out already, so an out → out settle moves no bout unless a reconcile was cut short).
--      The clocks are the SERVER's (ruling 150): a forfeit's `created_at`, a card's `recorded_at`
--      (0016:58), never the tablet's `occurred_at`. A review's `reviewed_at` is stamped by the API
--      and may be NULL; the earliest of the causes skips a NULL.
--   2. `settle_fighter_status` again, as 0242 wrote it, but its status is read from (1).
--   3. `fighters_status_under(p_tournament, p_rules_before, p_rules_after, p_also)` reads, for the
--      Tournament's Registrations, the status now, under the rules before and after, and when they
--      crossed under the rules after; a row for each whose status the change moves, whose stored
--      status is out of step with the rules after, or whose id the caller names (`p_also`, the
--      Fighters a follow must try again; a foreign id is dropped by the Tournament filter). Ordered
--      by `crossed_at`, then id: the API settles in this order and sorts nothing.
--   4. `repin_tournament_rules` again: it compares `forfeit_rules` with what the API read and writes
--      it (a JSON null stored as SQL NULL: 0236's CHECK refuses a JSON null), and refuses
--      `p_next_incomplete` when `p_next` names no `forfeit_rules`, so a missing key never wipes them.
-- Ruling 149 supersedes 0240:36-37 ("a Tournament's rules cannot change under scored bouts"): they
-- can now, through the audit; the API settles each Fighter the change moves after the write, and a
-- door that read the old rules is healed at the Fighter's next cause.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- Functions only: no table, no row, no constraint, so no `SET CONSTRAINTS` is needed. The two new
-- functions are SECURITY INVOKER and STABLE (they read; the API calls them as the service role),
-- search_path pinned, EXECUTE revoked from public, anon and authenticated BY NAME (the image grants
-- the two roles by name, 0190's header) and granted to the service role. The two re-issued
-- functions keep 0234's and 0242's posture, re-pinned below.

create or replace function public.fighter_status_under(
  p_registration uuid,
  p_rules jsonb,
  p_entry text
)
returns table (status text, crossed_at timestamptz)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with reg as (
    select r.id, r.tournament_id from public.registrations r where r.id = p_registration
  ),
  forfeits as (
    select f.* from public.match_forfeits f
      join reg on f.tournament_id = reg.tournament_id and f.forfeiting_registration_id = reg.id
     where f.voided_at is null
  ),
  -- "Disqualify after N": the forfeits the Fighter chose, none under what held them out (rulings
  -- 89, 118, 120), whether that is a forfeit record, the hand, a card or a review.
  counted as (
    select f.created_at, row_number() over (order by f.created_at, f.id) as n
      from forfeits f
     where f.parent_forfeit_id is null and not f.auto_created and not f.under_out_status
       and f.reason in (select jsonb_array_elements_text(p_rules -> 'countedReasons'))
  ),
  cards as (
    select p.id, p.recorded_at, row_number() over (order by p.recorded_at, p.id) as n
      from public.match_penalties p
      join reg on p.tournament_id = reg.tournament_id and p.registration_id = reg.id
     where p.card = 'black' and not p.voided
  ),
  arms (status, crossed) as (
    -- A forfeit that disqualified or withdrew, at its time.
    select f.fighter_outcome, f.created_at from forfeits f
     where f.fighter_outcome in ('disqualified', 'withdrawn')
    union all
    select 'disqualified', c.created_at from counted c
     where c.n = (p_rules ->> 'disqualifyAfter')::integer
    -- The black cards, under the 1st and the 2nd card's rule.
    union all
    select 'disqualified', k.recorded_at from cards k
     where k.n = 1 and (p_rules ->> 'firstCardOut')::boolean
    union all
    select 'disqualified', k.recorded_at from cards k
     where k.n = 2 and (p_rules ->> 'secondCardOut')::boolean
    -- A confirmed review stands while two of the cards it answered are live.
    union all
    select 'disqualified', r.reviewed_at from public.tournament_penalty_reviews r
      join reg on r.tournament_id = reg.tournament_id and r.registration_id = reg.id
     where r.review_type = 'second_black_card' and r.status = 'confirmed'
       and (select count(*) from cards k
             where k.id::text in (select jsonb_array_elements_text(
                                    r.payload_json -> 'answeredPenaltyIds'))) >= 2
  )
  select case
           when exists (select 1 from arms a where a.status = 'disqualified') then 'disqualified'
           when exists (select 1 from arms a where a.status = 'withdrawn') then 'withdrawn'
           else p_entry
         end,
         (select min(a.crossed) from arms a);
$$;

comment on function public.fighter_status_under(uuid, jsonb, text) is
  'The status a Registration has under the forfeit rules p_rules and the hand p_entry, and when the cause that puts them out happened (crossed_at; NULL when in, or out by the hand alone). The one owner of the status rule.';

create or replace function public.settle_fighter_status(
  p_registration uuid,
  p_rules jsonb,
  p_now timestamptz,
  p_entry_status text,
  p_expected_entry_status text,
  p_clear_waitlist boolean
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_catalog
as $$
declare
  reg public.registrations%rowtype;
  entry text;
  next_status text;
begin
  select * into reg from public.registrations where id = p_registration for no key update;
  if not found then
    raise exception 'registration % not found', p_registration using errcode = 'P0002';
  end if;
  if p_expected_entry_status is not null and reg.entry_status <> p_expected_entry_status then
    raise exception 'entry_status_changed: registration % is %, not %',
      p_registration, reg.entry_status, p_expected_entry_status using errcode = 'P0001';
  end if;
  entry := coalesce(p_entry_status, reg.entry_status);

  select u.status into next_status from public.fighter_status_under(reg.id, p_rules, entry) u;

  -- One statement: the tie CHECKs and 0078's waitlist CHECK hold on the row it leaves.
  update public.registrations
     set status = next_status,
         entry_status = entry,
         waitlist_position = case when p_clear_waitlist then null else reg.waitlist_position end,
         out_since = case
           when next_status not in ('withdrawn', 'disqualified') then null
           when reg.status in ('withdrawn', 'disqualified') then coalesce(reg.out_since, p_now)
           else p_now
         end
   where id = reg.id;
  return jsonb_build_object('before', reg.status, 'after', next_status);
end;
$$;

create or replace function public.fighters_status_under(
  p_tournament uuid,
  p_rules_before jsonb,
  p_rules_after jsonb,
  p_also uuid[]
)
returns table (
  registration_id uuid,
  status_now text,
  status_before text,
  status_after text,
  crossed_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select r.id, r.status, b.status, a.status, a.crossed_at
    from public.registrations r
    cross join lateral public.fighter_status_under(r.id, p_rules_before, r.entry_status) b
    cross join lateral public.fighter_status_under(r.id, p_rules_after, r.entry_status) a
   where r.tournament_id = p_tournament
     and (b.status <> a.status or r.status <> a.status or r.id = any(p_also))
   order by a.crossed_at nulls last, r.id;
$$;

comment on function public.fighters_status_under(uuid, jsonb, jsonb, uuid[]) is
  'The Registrations of a Tournament a forfeit rules change moves (status before <> after), those out of step with the rules after, and p_also: the status now, before and after, and crossed_at under the rules after. Ordered by crossed_at, then id.';

create or replace function public.repin_tournament_rules(
  p_tournament_id uuid,
  p_expected jsonb,
  p_next jsonb,
  p_audit jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  t record;
  v_id uuid;
begin
  if not (p_next ? 'forfeit_rules') then
    raise exception 'p_next_incomplete' using errcode = 'P0001';
  end if;
  select tr.event_id, tr.ruleset_code, tr.ruleset_version, tr.ruleset_config,
         tr.scoring_config_json, tr.penalty_ruleset_id, tr.penalty_ruleset_version,
         tr.forfeit_rules
    into t
    from public.tournaments tr
    where tr.id = p_tournament_id
    for no key update;
  if not found then
    raise exception 'Tournament % was not found', p_tournament_id
      using errcode = 'P0002';
  end if;
  if not (
    coalesce(to_jsonb(t.ruleset_code), 'null'::jsonb)
      is not distinct from coalesce(p_expected->'ruleset_code', 'null'::jsonb)
    and coalesce(to_jsonb(t.ruleset_version), 'null'::jsonb)
      is not distinct from coalesce(p_expected->'ruleset_version', 'null'::jsonb)
    and coalesce(to_jsonb(t.ruleset_config), 'null'::jsonb)
      is not distinct from coalesce(p_expected->'ruleset_config', 'null'::jsonb)
    and coalesce(to_jsonb(t.scoring_config_json), 'null'::jsonb)
      is not distinct from coalesce(p_expected->'scoring_config_json', 'null'::jsonb)
    and coalesce(to_jsonb(t.penalty_ruleset_id), 'null'::jsonb)
      is not distinct from coalesce(p_expected->'penalty_ruleset_id', 'null'::jsonb)
    and coalesce(to_jsonb(t.penalty_ruleset_version), 'null'::jsonb)
      is not distinct from coalesce(p_expected->'penalty_ruleset_version', 'null'::jsonb)
    and coalesce(to_jsonb(t.forfeit_rules), 'null'::jsonb)
      is not distinct from coalesce(p_expected->'forfeit_rules', 'null'::jsonb)
  ) then
    raise exception 'rules_changed_since_read' using errcode = 'P0001';
  end if;
  update public.tournaments
    set ruleset_code = p_next->>'ruleset_code',
        ruleset_version = p_next->>'ruleset_version',
        ruleset_config = nullif(p_next->'ruleset_config', 'null'::jsonb),
        scoring_config_json = nullif(p_next->'scoring_config_json', 'null'::jsonb),
        forfeit_rules = nullif(p_next->'forfeit_rules', 'null'::jsonb),
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
$$;

comment on function public.repin_tournament_rules(uuid, jsonb, jsonb, jsonb) is
  'An audited change of a Tournament''s rules: refuses p_next_incomplete without forfeit_rules, and rules_changed_since_read unless the row still holds p_expected (its forfeit rules too), else writes p_next, records p_audit, stamps the bouts not started and answers the record id.';

revoke execute on function public.fighter_status_under(uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.fighter_status_under(uuid, jsonb, text) to service_role;
revoke execute on function public.fighters_status_under(uuid, jsonb, jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function public.fighters_status_under(uuid, jsonb, jsonb, uuid[]) to service_role;
revoke execute on function public.settle_fighter_status(uuid, jsonb, timestamptz, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.settle_fighter_status(uuid, jsonb, timestamptz, text, text, boolean)
  to service_role;
revoke execute on function public.repin_tournament_rules(uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.repin_tournament_rules(uuid, jsonb, jsonb, jsonb) to service_role;

-- ── Prove what landed ────────────────────────────────────────────────────────
DO $$
DECLARE
  under regprocedure := 'public.fighter_status_under(uuid, jsonb, text)';
  many regprocedure := 'public.fighters_status_under(uuid, jsonb, jsonb, uuid[])';
  settle regprocedure := 'public.settle_fighter_status(uuid, jsonb, timestamptz, text, text, boolean)';
  repin regprocedure := 'public.repin_tournament_rules(uuid, jsonb, jsonb, jsonb)';
  fn regprocedure;
  body TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[under, many, settle, repin] LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE')
       OR has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '0246: a web role may execute %', fn;
    END IF;
    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '0246: the service role may not execute %', fn;
    END IF;
  END LOOP;

  IF (SELECT provolatile FROM pg_proc WHERE oid = under) <> 's'
     OR (SELECT provolatile FROM pg_proc WHERE oid = many) <> 's' THEN
    RAISE EXCEPTION '0246: fighter_status_under and fighters_status_under are not both STABLE';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = under) !~ '\ynot\s+f\.under_out_status\y' THEN
    RAISE EXCEPTION '0246: the "disqualify after N" count does not leave out a record under the out status';
  END IF;
  -- One owner of the rule: the set reads it through the one function, holding no copy of it.
  IF (SELECT prosrc FROM pg_proc WHERE oid = many) ~* '\y(match_forfeits|match_penalties|under_out_status)\y'
     OR (SELECT prosrc FROM pg_proc WHERE oid = many) !~ '\ypublic\.fighter_status_under\(' THEN
    RAISE EXCEPTION '0246: fighters_status_under holds a copy of the status rule';
  END IF;

  IF (SELECT provolatile FROM pg_proc WHERE oid = settle) <> 'v' THEN
    RAISE EXCEPTION '0246: settle_fighter_status is not VOLATILE';
  END IF;
  SELECT substring(prosrc FROM '\ybegin\y(.*)$') INTO body FROM pg_proc WHERE oid = settle;
  IF body IS NULL OR body !~* '^\s*select\y[^;]*\yfrom\s+public\.registrations\y[^;]*\yfor\s+no\s+key\s+update\s*;' THEN
    RAISE EXCEPTION '0246: settle_fighter_status does not lock the Registration first';
  END IF;
  IF body !~ '\ypublic\.fighter_status_under\(' OR body ~* '\y(match_forfeits|match_penalties)\y' THEN
    RAISE EXCEPTION '0246: settle_fighter_status does not read its status from fighter_status_under alone';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
