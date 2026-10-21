-- 0242: a forfeit recorded while a card or a review holds the Fighter out belongs to it (slice B;
-- operator ruling 120, 2026-10-22).
--
-- THE DEFECT. Ruling 118 (0241) marked a forfeit recorded by hand on a bout put back while the
-- organiser's hand held its Fighter withdrawn: it counts toward no "disqualify after N", and the
-- Fighter's return voids it. A black card or a confirmed second-black-card review can hold a
-- Fighter out with no forfeit record to hang such a forfeit off either: a card given after its
-- bout writes no forfeit (ruling 57), and the second card's forfeit does not withdraw while its
-- review is open. A forfeit recorded on a bout put back while she was out by one of those was a
-- forfeit of her own: it counted toward "after N", and dismissing the review left it standing.
--
-- THE RULE. A forfeit recorded by hand on a bout forfeited because its Fighter was out, while the
-- Fighter is out and no live root forfeit withdrew them, belongs to whatever holds them out: the
-- hand, a black card, a confirmed review. It counts toward no "disqualify after N", and once
-- nothing holds the Fighter out it is voided and its bout put back (`fighter-reconcile.ts`
-- bringBack).
--
-- WHAT CHANGES.
--   1. `match_forfeits.under_hand_withdrawal` is renamed `under_out_status`: the API now sets it
--      for every cause with no record, not for the hand alone.
--   2. `settle_fighter_status` again, as 0241 wrote it but for the column's name: a plpgsql body
--      names its columns as text, and a rename does not rewrite it.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- One column renamed on a table whose writes are the API's alone (0238). The function keeps
-- 0240's posture: SECURITY INVOKER, search_path pinned, EXECUTE revoked from public, anon and
-- authenticated by name and granted to the service role; its lock and its volatility are pinned
-- again below (`create or replace` keeps the grants, the pins prove it).

-- A guard: no deferred check may be pending when the ALTER below runs (0237's deferred keys).
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE public.match_forfeits RENAME COLUMN under_hand_withdrawal TO under_out_status;

COMMENT ON COLUMN public.match_forfeits.under_out_status IS
  'True on a forfeit recorded by hand, on a bout put back, while its Fighter was out by a cause with no forfeit record to hang it off: the organiser''s hand, a black card, a confirmed review (rulings 118, 120). An effect of that cause: counted toward no "disqualify after N", voided once the Fighter is back in.';

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
  cards integer;
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

  select count(*) into cards from public.match_penalties p
   where p.tournament_id = reg.tournament_id and p.registration_id = reg.id
     and p.card = 'black' and not p.voided;

  next_status := case
    -- A forfeit that disqualified, at its time.
    when exists (select 1 from public.match_forfeits f
                  where f.tournament_id = reg.tournament_id and f.forfeiting_registration_id = reg.id
                    and f.voided_at is null and f.fighter_outcome = 'disqualified')
      -- "Disqualify after N": the forfeits the Fighter chose, none under what held them out
      -- (rulings 89, 118, 120), whether that is a forfeit record, the hand, a card or a review.
      or (p_rules ->> 'disqualifyAfter') is not null
         and (select count(*) from public.match_forfeits f
               where f.tournament_id = reg.tournament_id and f.forfeiting_registration_id = reg.id
                 and f.voided_at is null and f.parent_forfeit_id is null and not f.auto_created
                 and not f.under_out_status
                 and f.reason in (select jsonb_array_elements_text(p_rules -> 'countedReasons')))
             >= (p_rules ->> 'disqualifyAfter')::integer
      -- The black cards, under the 1st and the 2nd card's rule.
      or cards >= 1 and (p_rules ->> 'firstCardOut')::boolean
      or cards >= 2 and (p_rules ->> 'secondCardOut')::boolean
      -- A confirmed review stands while two of the cards it answered are live.
      or exists (select 1 from public.tournament_penalty_reviews r
                  where r.tournament_id = reg.tournament_id and r.registration_id = reg.id
                    and r.review_type = 'second_black_card' and r.status = 'confirmed'
                    and (select count(*) from public.match_penalties p
                          where p.tournament_id = reg.tournament_id and p.registration_id = reg.id
                            and p.card = 'black' and not p.voided
                            and p.id::text in (select jsonb_array_elements_text(
                                                 r.payload_json -> 'answeredPenaltyIds'))) >= 2)
      then 'disqualified'
    when exists (select 1 from public.match_forfeits f
                  where f.tournament_id = reg.tournament_id and f.forfeiting_registration_id = reg.id
                    and f.voided_at is null and f.fighter_outcome = 'withdrawn')
      then 'withdrawn'
    else entry
  end;

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

revoke execute on function public.settle_fighter_status(uuid, jsonb, timestamptz, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.settle_fighter_status(uuid, jsonb, timestamptz, text, text, boolean)
  to service_role;

-- ── Prove what landed ────────────────────────────────────────────────────────
DO $$
DECLARE
  fn regprocedure := 'public.settle_fighter_status(uuid, jsonb, timestamptz, text, text, boolean)';
  body TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'match_forfeits'
       AND column_name = 'under_out_status' AND data_type = 'boolean'
       AND is_nullable = 'NO' AND column_default = 'false'
  ) THEN
    RAISE EXCEPTION '0242: match_forfeits.under_out_status is not a NOT NULL boolean defaulting to false';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'match_forfeits'
       AND column_name = 'under_hand_withdrawal'
  ) THEN
    RAISE EXCEPTION '0242: match_forfeits.under_hand_withdrawal is still there';
  END IF;

  -- 0240's pins, on the function as it now is.
  IF has_function_privilege('anon', fn, 'EXECUTE')
     OR has_function_privilege('authenticated', fn, 'EXECUTE') THEN
    RAISE EXCEPTION '0242: a web role may execute settle_fighter_status';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = fn) <> 'v' THEN
    RAISE EXCEPTION '0242: settle_fighter_status is not VOLATILE';
  END IF;
  SELECT substring(prosrc FROM '\ybegin\y(.*)$') INTO body FROM pg_proc WHERE oid = fn;
  IF body IS NULL OR body !~* '^\s*select\y[^;]*\yfrom\s+public\.registrations\y[^;]*\yfor\s+no\s+key\s+update\s*;' THEN
    RAISE EXCEPTION '0242: settle_fighter_status does not lock the Registration first';
  END IF;
  IF body !~ '\ynot\s+f\.under_out_status\y' THEN
    RAISE EXCEPTION '0242: the "disqualify after N" count does not leave out a record under the out status';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
