-- 0241: a Fighter's Pool bouts follow their status (slice B, commit B2; operator rulings 57, 78,
-- 105, 106, 109, 110, 118, 2026-10-20 and 2026-10-21).
--
-- THE DEFECT. Since 0240 a Fighter's status is worked out from what is live, but their bouts still
-- followed one forfeit: only a forfeit that withdrew its Fighter forfeited their remaining Pool
-- bouts, and only its own take-back put them back. A black card or a confirmed review that
-- disqualified, and the organiser's hand withdrawal, forfeited nothing; a Fighter brought back in
-- by another void kept their bouts forfeited.
--
-- THE RULE. After every settle the API makes the bouts follow the status: while the Fighter is
-- out, their scheduled and paused Pool bouts are forfeited ("taken out"); once nothing holds them
-- out, the bouts forfeited because they were out are voided and put back ("brought back"). A bout
-- the organiser put back by hand during the current spell out stays put back.
--
-- WHAT CHANGES.
--   1. `match_forfeits.voided_by_return`: true on a record the API voided because its Fighter came
--      back in. The organiser's voids (the take-back door, a Reset or Reopen) leave it false, and
--      that is how the API tells a bout put back by hand, which it leaves alone, from one it put
--      back itself, which it forfeits again on the Fighter's next spell out.
--   2. `match_forfeits.under_hand_withdrawal` (ruling 118): a forfeit recorded by hand on a bout
--      put back while the organiser's hand holds the Fighter withdrawn. A hand withdrawal writes no
--      record to hang it off (ruling 89's `parent_forfeit_id`), so this marks it as one of that
--      withdrawal's effects: it counts toward no "disqualify after N", and the undo of the
--      withdrawal brings it back.
--   3. `settle_fighter_status` again, as 0240 wrote it but for the count of "disqualify after N",
--      which now leaves out a record under the hand as it leaves out one under a root.
--   4. `match_forfeits.previous_registration_state` goes. It held the status a forfeit found, which
--      the take-back wrote back blind to every later cause; nothing reads it since 0240. The
--      archive leaves the key out of a restore of an older archive (`archive.tables.ts`).
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- Two columns added to a table whose writes are the API's alone (0238); one column dropped. The
-- function keeps 0240's posture: SECURITY INVOKER, search_path pinned, EXECUTE revoked from
-- public, anon and authenticated by name and granted to the service role; its lock and its
-- volatility are pinned again below (`create or replace` keeps the grants, the pins prove it).

-- A guard: no deferred check may be pending when the ALTERs below run (0237's deferred keys).
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE public.match_forfeits
  ADD COLUMN voided_by_return boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.match_forfeits.voided_by_return IS
  'True when the API voided this record because its Fighter came back in (their bouts follow their status). False on every void by a person: a bout the organiser put back stays put back during the Fighter''s current spell out.';

ALTER TABLE public.match_forfeits
  ADD COLUMN under_hand_withdrawal boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.match_forfeits.under_hand_withdrawal IS
  'True on a forfeit recorded by hand, on a bout put back, while the organiser''s hand held its Fighter withdrawn (ruling 118): an effect of that withdrawal, counted toward no "disqualify after N", brought back by its undo.';

ALTER TABLE public.match_forfeits DROP COLUMN previous_registration_state;

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
      -- "Disqualify after N": the forfeits the Fighter chose, none under a withdrawal (rulings 89,
      -- 118), whether that withdrawal is a forfeit record or the organiser's hand.
      or (p_rules ->> 'disqualifyAfter') is not null
         and (select count(*) from public.match_forfeits f
               where f.tournament_id = reg.tournament_id and f.forfeiting_registration_id = reg.id
                 and f.voided_at is null and f.parent_forfeit_id is null and not f.auto_created
                 and not f.under_hand_withdrawal
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
  col TEXT;
BEGIN
  FOREACH col IN ARRAY ARRAY['voided_by_return', 'under_hand_withdrawal'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'match_forfeits'
         AND column_name = col AND data_type = 'boolean'
         AND is_nullable = 'NO' AND column_default = 'false'
    ) THEN
      RAISE EXCEPTION '0241: match_forfeits.% is not a NOT NULL boolean defaulting to false', col;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'match_forfeits'
       AND column_name = 'previous_registration_state'
  ) THEN
    RAISE EXCEPTION '0241: match_forfeits.previous_registration_state is still there';
  END IF;

  -- 0240's pins, on the function as it now is.
  IF has_function_privilege('anon', fn, 'EXECUTE')
     OR has_function_privilege('authenticated', fn, 'EXECUTE') THEN
    RAISE EXCEPTION '0241: a web role may execute settle_fighter_status';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = fn) <> 'v' THEN
    RAISE EXCEPTION '0241: settle_fighter_status is not VOLATILE';
  END IF;
  SELECT substring(prosrc FROM '\ybegin\y(.*)$') INTO body FROM pg_proc WHERE oid = fn;
  IF body IS NULL OR body !~* '^\s*select\y[^;]*\yfrom\s+public\.registrations\y[^;]*\yfor\s+no\s+key\s+update\s*;' THEN
    RAISE EXCEPTION '0241: settle_fighter_status does not lock the Registration first';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
