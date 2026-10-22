-- 0243: a Swiss round is written in one locked step, and a withdraw takes the same lock (slice
-- B-Swiss, commit BS1; plan `slice-b-swiss-plan.md` §2.1-§2.4).
--
-- THE DEFECTS. The pairing read the entrants, then inserted the round, then its bouts: three calls
-- with no lock (`swiss-pairing.service.ts` commitNextRound). A withdraw landing between them read
-- "N rounds" and stored `withdrawn_at_round = N+1` for a Fighter the new round N+1 held: round N+1
-- then failed its own validation ("unknown"), and round N+2 could never be paired. And a bout
-- insert that failed after the round insert left a round with no bouts, which every retry met as
-- "already committed".
--
-- THE RULE. A round and its bouts are written by `swiss_commit_round`, in one transaction, under
-- the phase's row lock; it re-checks that the field the round was planned from is still the
-- active field, and answers 'stale' (the API plans again) when it is not. A withdraw is
-- `swiss_withdraw`, under the same lock: it reads the rounds after any commit before it.
--
-- WHAT CHANGES.
--   1. `swiss_entrants.withdrawn_by` ('hand' | 'status'): who withdrew the entrant. Every
--      withdrawal before 0243 was the organiser's (the Withdraw door was its one writer).
--      'status' is written from 0244, when a Fighter's status takes them out of the pairings.
--   2. `swiss_withdraw(p_phase, p_registration, p_by)`.
--   3. `swiss_commit_round(p_phase, p_round, p_field, p_bye, p_meta, p_bouts)`.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- One column on a table whose policies are unchanged (0164, 0200; its web write door is ruling
-- 98's sweep). Both functions take 0240's posture: SECURITY INVOKER, search_path pinned, EXECUTE
-- revoked from public, anon and authenticated by name and granted to the service role; their lock
-- (the FIRST statement, FOR NO KEY UPDATE of the phase, so the FK checks of the rows they insert,
-- FOR KEY SHARE, do not wait on it) and their volatility are pinned below. No deadlock: each
-- locks one `phases` row and no `registrations` row.

-- A guard: no deferred check may be pending when the ALTERs below run (0237's deferred keys).
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE public.swiss_entrants ADD COLUMN withdrawn_by text;
UPDATE public.swiss_entrants SET withdrawn_by = 'hand' WHERE withdrawn_at_round IS NOT NULL;
ALTER TABLE public.swiss_entrants
  ADD CONSTRAINT swiss_entrants_withdrawn_by_allowed
  CHECK (withdrawn_by IN ('hand', 'status'));
ALTER TABLE public.swiss_entrants
  ADD CONSTRAINT swiss_entrants_withdrawn_by_follows_round
  CHECK ((withdrawn_by IS NULL) = (withdrawn_at_round IS NULL));

COMMENT ON COLUMN public.swiss_entrants.withdrawn_by IS
  'Who withdrew the entrant from the pairings: hand (the organiser''s Withdraw) or status (the Fighter''s status took them out). Null exactly while they are paired. Written by swiss_withdraw.';

-- Answers {withdrawnAtRound, changed}. An entrant already withdrawn keeps the round and the kind
-- they were withdrawn with: a status withdraw never takes over a hand one.
create or replace function public.swiss_withdraw(
  p_phase uuid,
  p_registration uuid,
  p_by text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_catalog
as $$
declare
  phase_row uuid;
  entrant public.swiss_entrants%rowtype;
  next_round integer;
begin
  select id into phase_row from public.phases where id = p_phase and type = 'swiss' for no key update;
  if not found then
    raise exception 'swiss phase % not found', p_phase using errcode = 'P0002';
  end if;
  if p_by is null or p_by not in ('hand', 'status') then
    raise exception 'unknown withdrawal kind %', p_by using errcode = '22023';
  end if;
  select * into entrant from public.swiss_entrants
   where phase_id = p_phase and registration_id = p_registration;
  if not found then
    raise exception 'registration % is not in swiss phase %', p_registration, p_phase
      using errcode = 'P0002';
  end if;
  if entrant.withdrawn_at_round is not null then
    return jsonb_build_object('withdrawnAtRound', entrant.withdrawn_at_round, 'changed', false);
  end if;
  -- Read under the lock: a round committed before this withdraw is counted.
  select coalesce(max(round_number), 0) + 1 into next_round
    from public.swiss_rounds where phase_id = p_phase;
  update public.swiss_entrants
     set withdrawn_at_round = next_round, withdrawn_by = p_by
   where id = entrant.id;
  return jsonb_build_object('withdrawnAtRound', next_round, 'changed', true);
end;
$$;

-- p_field: the entrants the round was planned from (the active field for p_round). p_bouts: the
-- bouts as `swissMatchRows` builds them, without phase_id and swiss_round_id (set here). The bouts
-- and the bye are trusted to come from that field: the one caller builds all three from one plan
-- (`swiss-commit.ts`). Answers
-- {status: 'committed', roundId, matchIds} with the ids in board order, {status: 'exists',
-- roundId} when the round stands already, or {status: 'stale'} when a round was added or deleted,
-- or the field changed, since the plan.
create or replace function public.swiss_commit_round(
  p_phase uuid,
  p_round integer,
  p_field uuid[],
  p_bye uuid,
  p_meta jsonb,
  p_bouts jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_catalog
as $$
declare
  phase_row uuid;
  existing uuid;
  last_round integer;
  active uuid[];
  planned uuid[] := coalesce(p_field, '{}');
  new_round uuid;
  ids uuid[];
begin
  select id into phase_row from public.phases where id = p_phase and type = 'swiss' for no key update;
  if not found then
    raise exception 'swiss phase % not found', p_phase using errcode = 'P0002';
  end if;
  select id into existing from public.swiss_rounds
   where phase_id = p_phase and round_number = p_round;
  if found then
    return jsonb_build_object('status', 'exists', 'roundId', existing);
  end if;
  select coalesce(max(round_number), 0) into last_round
    from public.swiss_rounds where phase_id = p_phase;
  if last_round + 1 <> p_round then
    return jsonb_build_object('status', 'stale');
  end if;
  -- The active field for p_round, as `activeEntrants` reads it (swiss-snapshot.ts); compared as a
  -- set both ways: an extra Fighter would be "unknown" in the round, a missing one "missing".
  select coalesce(array_agg(registration_id), '{}') into active
    from public.swiss_entrants
   where phase_id = p_phase and (withdrawn_at_round is null or withdrawn_at_round > p_round);
  if not (active @> planned and planned @> active) then
    return jsonb_build_object('status', 'stale');
  end if;

  insert into public.swiss_rounds (phase_id, round_number, status, bye_registration_id, pairing_meta_json)
  values (p_phase, p_round, 'pending', p_bye, p_meta)
  returning id into new_round;

  -- One transaction with the round: a bout that fails leaves no round behind.
  with inserted as (
    insert into public.matches (
      phase_id, swiss_round_id, red_registration_id, blue_registration_id, status,
      match_number_label, match_rules_id
    )
    select p_phase, new_round, b.red_registration_id, b.blue_registration_id, b.status,
           b.match_number_label, b.match_rules_id
      from jsonb_to_recordset(coalesce(p_bouts, '[]'::jsonb)) as b(
        red_registration_id uuid, blue_registration_id uuid, status text,
        match_number_label text, match_rules_id uuid
      )
    returning id, match_number_label
  )
  -- Labels are zero-padded per round (swiss-match-rows.ts): text order is board order.
  select coalesce(array_agg(id order by match_number_label), '{}') into ids from inserted;

  return jsonb_build_object('status', 'committed', 'roundId', new_round, 'matchIds', to_jsonb(ids));
end;
$$;

comment on function public.swiss_withdraw(uuid, uuid, text) is
  'Withdraws an entrant from the later rounds of a Swiss phase, under the phase''s row lock: from the round after the last one written. Answers {withdrawnAtRound, changed}.';
comment on function public.swiss_commit_round(uuid, integer, uuid[], uuid, jsonb, jsonb) is
  'Writes a Swiss round and its bouts in one step under the phase''s row lock, when the field it was planned from is still the active field. Answers {status: committed|exists|stale, ...}.';

revoke execute on function public.swiss_withdraw(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.swiss_withdraw(uuid, uuid, text) to service_role;
revoke execute on function public.swiss_commit_round(uuid, integer, uuid[], uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.swiss_commit_round(uuid, integer, uuid[], uuid, jsonb, jsonb)
  to service_role;

-- ── Prove what landed ────────────────────────────────────────────────────────
DO $$
DECLARE
  def TEXT;
  body TEXT;
  fn regprocedure;
  wanted CONSTANT TEXT[][] := ARRAY[
    ['swiss_entrants_withdrawn_by_allowed',
     'CHECK ((withdrawn_by = ANY (ARRAY[''hand''::text, ''status''::text])))'],
    ['swiss_entrants_withdrawn_by_follows_round',
     'CHECK (((withdrawn_by IS NULL) = (withdrawn_at_round IS NULL)))']
  ];
  locked CONSTANT TEXT[] := ARRAY[
    'public.swiss_withdraw(uuid, uuid, text)',
    'public.swiss_commit_round(uuid, integer, uuid[], uuid, jsonb, jsonb)'
  ];
BEGIN
  FOR i IN 1 .. array_length(wanted, 1) LOOP
    SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
     WHERE conrelid = 'public.swiss_entrants'::regclass AND conname = wanted[i][1];
    IF def IS DISTINCT FROM wanted[i][2] THEN
      RAISE EXCEPTION '0243: % is %', wanted[i][1], def;
    END IF;
  END LOOP;

  FOREACH def IN ARRAY locked LOOP
    fn := def::regprocedure;
    IF has_function_privilege('anon', fn, 'EXECUTE')
       OR has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '0243: a web role may execute %', fn;
    END IF;
    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '0243: the service role may not execute %', fn;
    END IF;
    IF (SELECT provolatile FROM pg_proc WHERE oid = fn) <> 'v' THEN
      RAISE EXCEPTION '0243: % is not VOLATILE', fn;
    END IF;
    -- The lock is the function's FIRST statement (the text pin, see the header).
    SELECT substring(prosrc FROM '\ybegin\y(.*)$') INTO body FROM pg_proc WHERE oid = fn;
    IF body IS NULL OR body !~* '^\s*select\y[^;]*\yfrom\s+public\.phases\y[^;]*\yfor\s+no\s+key\s+update\s*;' THEN
      RAISE EXCEPTION '0243: % does not lock the phase first', fn;
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
