-- 0240: a Fighter's status in a Tournament is worked out from its causes (slice B, operator rulings
-- 57, 78-80, 83, 105-112, 2026-10-20 and 2026-10-21).
--
-- THE DEFECT. Five hands wrote `registrations.status`: a forfeit, a black card (its first send, its
-- tablet's re-send, a confirmed review), the organiser, the waitlist promotes, and the void of a
-- forfeit, which wrote back the status that forfeit FOUND, blind to every cause since. A Fighter
-- disqualified after two forfeits came back in when the first was voided; one withdrawn by an injury
-- and disqualified by a card in another Pool came back in when the injury was voided.
--
-- THE RULE. A Fighter's status is one function of what is live now: their live forfeits, their live
-- black cards under the rules in force, a confirmed review, and the organiser's hand. Only
-- `settle_fighter_status` writes it in the API, in one locked step, after each cause is written.
-- (The web policy `registrations_write`, 0002, still lets a web role write a row: ruling 98's
-- sweep closes it.)
--
-- WHAT CHANGES.
--   1. `match_forfeits.fighter_outcome`: what a forfeit did to its Fighter, at its time
--      ('withdrawn' | 'disqualified' | NULL = continues). Written once, at the insert, by the API.
--   2. `registrations.entry_status`: the organiser's hand ('registered' | 'checked_in' |
--      'withdrawn' | 'waitlist'). `status` follows it unless a cause holds the Fighter out
--      (`registrations_status_follows_entry`). Backfilled from `status`; a Fighter out today is
--      taken as checked in (no row records whether a hand put them out; the stack is wiped).
--   3. `registrations.out_since`: when the Fighter's current spell out began, set exactly while
--      they are out (`registrations_out_since_follows_status`).
--   4. `settle_fighter_status(...)`: the one writer of the three columns of a Fighter's status.
--
-- THE LOCK. The function's first statement takes the Registration's row `FOR NO KEY UPDATE`: every
-- settle of one Fighter waits for the one before it to commit, then reads the causes as committed.
-- Each door writes its cause first (its own call), so the last settle to run reads every cause.
-- `NO KEY`: a new forfeit or card naming the Fighter checks its key with `FOR KEY SHARE`, which this
-- does not block. VOLATILE, so each statement after the lock wait reads fresh rows. The probe cannot
-- show a second settle waiting (it runs in one rolled-back transaction), so the DO block below pins
-- the lock by the function's text, and probe check 16 reads it again on every replay.
--
-- THE RULES IN FORCE are the API's (`p_rules`): "disqualify after N" (null = off), whether a 1st
-- and a 2nd black card put the Fighter out, and the reasons the count counts. A Tournament's rules
-- cannot change under scored bouts (ruling 73's lock); a door that changes them must settle.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- SECURITY INVOKER: the API calls it as the service role (BYPASSRLS). search_path pinned. EXECUTE
-- revoked from public, anon and authenticated BY NAME (the Supabase image grants the two roles by
-- name, 0190's header) and granted to the service role. No new table.

-- A guard: no deferred check may be pending when the ALTERs below run (0237's deferred keys).
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE public.match_forfeits ADD COLUMN fighter_outcome text;
ALTER TABLE public.match_forfeits
  ADD CONSTRAINT match_forfeits_fighter_outcome_allowed
  CHECK (fighter_outcome IN ('withdrawn', 'disqualified'));

ALTER TABLE public.registrations ADD COLUMN entry_status text NOT NULL DEFAULT 'registered';
ALTER TABLE public.registrations
  ADD CONSTRAINT registrations_entry_status_allowed
  CHECK (entry_status IN ('registered', 'checked_in', 'withdrawn', 'waitlist'));
UPDATE public.registrations
   SET entry_status = CASE WHEN status IN ('withdrawn', 'disqualified') THEN 'checked_in'
                           ELSE status END;
ALTER TABLE public.registrations
  ADD CONSTRAINT registrations_status_follows_entry
  CHECK (status = entry_status OR status IN ('withdrawn', 'disqualified'));

ALTER TABLE public.registrations ADD COLUMN out_since timestamptz;
UPDATE public.registrations SET out_since = now() WHERE status IN ('withdrawn', 'disqualified');
ALTER TABLE public.registrations
  ADD CONSTRAINT registrations_out_since_follows_status
  CHECK ((out_since IS NULL) = (status NOT IN ('withdrawn', 'disqualified')));

-- p_entry_status: the organiser's new hand, or null to keep it. p_expected_entry_status: the hand
-- the door read, or null; another one refuses with 'entry_status_changed' (two PATCHes at once,
-- two promotes of one Fighter). p_clear_waitlist: the promote's seat (waitlist_position goes).
-- Answers {before, after}: the status the Fighter had and has.
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
      -- "Disqualify after N": the forfeits the Fighter chose, none under a withdrawal (ruling 89).
      or (p_rules ->> 'disqualifyAfter') is not null
         and (select count(*) from public.match_forfeits f
               where f.tournament_id = reg.tournament_id and f.forfeiting_registration_id = reg.id
                 and f.voided_at is null and f.parent_forfeit_id is null and not f.auto_created
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

comment on function public.settle_fighter_status(uuid, jsonb, timestamptz, text, text, boolean) is
  'The one writer of a Fighter''s status: worked out from their live forfeits, black cards, a confirmed review and the organiser''s hand, under the row lock of their Registration. Answers {before, after}.';

revoke execute on function public.settle_fighter_status(uuid, jsonb, timestamptz, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.settle_fighter_status(uuid, jsonb, timestamptz, text, text, boolean)
  to service_role;

COMMENT ON COLUMN public.match_forfeits.fighter_outcome IS
  'What the forfeit did to its Fighter at its time: withdrawn, disqualified, or null (continues; also every bout forfeited under a withdrawal and every black card forfeit, whose card is the cause). Read by settle_fighter_status.';
COMMENT ON COLUMN public.registrations.entry_status IS
  'The organiser''s hand: registered, checked_in, withdrawn or waitlist. status equals it unless a cause holds the Fighter out (registrations_status_follows_entry). Written by settle_fighter_status.';
COMMENT ON COLUMN public.registrations.out_since IS
  'When the Fighter''s current spell out of the Tournament began; null while they are in. Written by settle_fighter_status.';

-- ── Prove what landed ────────────────────────────────────────────────────────
DO $$
DECLARE
  def TEXT;
  fn regprocedure := 'public.settle_fighter_status(uuid, jsonb, timestamptz, text, text, boolean)';
  body TEXT;
  wanted CONSTANT TEXT[][] := ARRAY[
    ['match_forfeits', 'match_forfeits_fighter_outcome_allowed',
     'CHECK ((fighter_outcome = ANY (ARRAY[''withdrawn''::text, ''disqualified''::text])))'],
    ['registrations', 'registrations_entry_status_allowed',
     'CHECK ((entry_status = ANY (ARRAY[''registered''::text, ''checked_in''::text, ''withdrawn''::text, ''waitlist''::text])))'],
    ['registrations', 'registrations_status_follows_entry',
     'CHECK (((status = entry_status) OR (status = ANY (ARRAY[''withdrawn''::text, ''disqualified''::text]))))'],
    ['registrations', 'registrations_out_since_follows_status',
     'CHECK (((out_since IS NULL) = (status <> ALL (ARRAY[''withdrawn''::text, ''disqualified''::text]))))']
  ];
BEGIN
  FOR i IN 1 .. array_length(wanted, 1) LOOP
    SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
     WHERE conrelid = ('public.' || wanted[i][1])::regclass AND conname = wanted[i][2];
    IF def IS DISTINCT FROM wanted[i][3] THEN
      RAISE EXCEPTION '0240: % is %', wanted[i][2], def;
    END IF;
  END LOOP;

  IF has_function_privilege('anon', fn, 'EXECUTE')
     OR has_function_privilege('authenticated', fn, 'EXECUTE') THEN
    RAISE EXCEPTION '0240: a web role may execute settle_fighter_status';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = fn) <> 'v' THEN
    RAISE EXCEPTION '0240: settle_fighter_status is not VOLATILE';
  END IF;
  -- The lock is the function's FIRST statement (the text pin, see the header).
  SELECT substring(prosrc FROM '\ybegin\y(.*)$') INTO body FROM pg_proc WHERE oid = fn;
  IF body IS NULL OR body !~* '^\s*select\y[^;]*\yfrom\s+public\.registrations\y[^;]*\yfor\s+no\s+key\s+update\s*;' THEN
    RAISE EXCEPTION '0240: settle_fighter_status does not lock the Registration first';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
