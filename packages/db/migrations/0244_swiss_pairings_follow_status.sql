-- 0244: a Swiss Fighter's pairings follow their status, and the organiser can put a withdrawn
-- Fighter back in the pairings (slice B-Swiss, commit BS2; plan `slice-b-swiss-plan.md` §2.1-§2.3;
-- operator rulings 77, 81, 108, 121-126).
--
-- THE RULES.
--   - A Fighter whose status goes out is withdrawn from the pairings of every Swiss phase they are
--     in, from the next round (77): `swiss_withdraw(…, 'status')`, called by the status reconcile.
--   - When nothing holds them out any more, they are put back, unless a round was paired without
--     them meanwhile (81): `swiss_put_back(…, 'status')`. Never over a withdrawal by hand.
--   - "Put back in the pairings" (108, 122): `swiss_put_back(…, 'hand')`, any withdrawn entrant,
--     refused while the Fighter is out of the Tournament. The rounds they missed count nothing
--     (121): `swiss_entrants.missed_rounds` keeps them out of those rounds' fields, so the rounds
--     stay valid.
--   - A Swiss phase that is over is left alone by a status change (125, 126): `swiss_phase_over`,
--     the one owner of "over" — finalised, or its last configured round paired and fought.
--   - The last round is deleted by `swiss_delete_last_round`, in one step with forgetting its
--     number from `missed_rounds`: missed rounds hold only rounds that exist, which is why
--     `swiss_commit_round` (0243) reads no `missed_rounds`.
--
-- WHAT CHANGES.
--   1. `swiss_entrants.missed_rounds integer[]`, with its CHECK.
--   2. `swiss_phase_over(p_phase)`: a read, no lock (called inside the locked functions, and by
--      the status reconcile to skip a phase that is over).
--   3. `swiss_withdraw` again: a status withdraw on a phase that is over writes nothing.
--   4. `swiss_put_back(p_phase, p_registration, p_by)`.
--   5. `swiss_delete_last_round(p_phase, p_round, p_fought)`: `p_fought` is the API's
--      `FOUGHT_STATUSES`, passed in so the SQL never retypes it.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- One column on a table whose policies are unchanged (its web write door is ruling 98's sweep).
-- Every function takes 0240's posture: SECURITY INVOKER, search_path pinned, EXECUTE revoked from
-- public, anon and authenticated by name and granted to the service role. The three that write
-- lock the phase row FOR NO KEY UPDATE as their FIRST statement; `swiss_phase_over` takes no lock.
-- All pinned below.

-- A guard: no deferred check may be pending when the ALTER below runs (0237's deferred keys).
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE public.swiss_entrants ADD COLUMN missed_rounds integer[] NOT NULL DEFAULT '{}';
ALTER TABLE public.swiss_entrants
  ADD CONSTRAINT swiss_entrants_missed_rounds_valid
  CHECK (coalesce(array_ndims(missed_rounds), 1) = 1
         AND array_position(missed_rounds, NULL) IS NULL
         AND 1 <= ALL (missed_rounds));

COMMENT ON COLUMN public.swiss_entrants.missed_rounds IS
  'The rounds an entrant put back in the pairings missed while withdrawn: they take no part in them, and those rounds count nothing for them (ruling 121). Holds only rounds that exist. Written by swiss_put_back, forgotten by swiss_delete_last_round.';

-- True when a status change no longer touches the phase: finalised, or its last configured round
-- paired with at least one bout and every bout completed (a round with no bout is 'pending', as
-- `deriveRoundStatus` reads it). A config the web door wrote badly reads "not over".
create or replace function public.swiss_phase_over(p_phase uuid)
returns boolean
language plpgsql
volatile
security invoker
set search_path = public, pg_catalog
as $$
declare
  cfg jsonb;
  last_round uuid;
  last_number integer;
begin
  select config_json into cfg from public.phases where id = p_phase and type = 'swiss';
  if not found then
    raise exception 'swiss phase % not found', p_phase using errcode = 'P0002';
  end if;
  -- Every phase stores the key: a JSON null is "not finalised", never "set".
  if jsonb_typeof(cfg -> 'finalized') = 'object' then
    return true;
  end if;
  if jsonb_typeof(cfg -> 'roundCount') is distinct from 'number' then
    return false;
  end if;
  select id, round_number into last_round, last_number
    from public.swiss_rounds where phase_id = p_phase
   order by round_number desc limit 1;
  if not found or last_number < (cfg ->> 'roundCount')::numeric then
    return false;
  end if;
  -- Over a round with no bout `bool_and` is NULL, which reads "not over".
  return coalesce((select bool_and(m.status = 'completed')
                     from public.matches m where m.swiss_round_id = last_round), false);
end;
$$;

-- As 0243's, but a status withdraw on a phase that is over writes nothing (ruling 125).
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
  if p_by = 'status' and public.swiss_phase_over(p_phase) then
    return jsonb_build_object('withdrawnAtRound', null, 'changed', false);
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

-- p_by 'status': the reconcile, once nothing holds the Fighter out (77, 81). p_by 'hand': "Put
-- back in the pairings" (108, 122). Answers {status: 'in' | 'kept' | 'put_back', missedRounds};
-- a hand put-back of a Fighter out of the Tournament raises 'fighter_out'.
create or replace function public.swiss_put_back(
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
  fighter_status text;
  fighter_out boolean;
  last_round integer;
  missed integer[];
begin
  select id into phase_row from public.phases where id = p_phase and type = 'swiss' for no key update;
  if not found then
    raise exception 'swiss phase % not found', p_phase using errcode = 'P0002';
  end if;
  if p_by is null or p_by not in ('hand', 'status') then
    raise exception 'unknown put-back kind %', p_by using errcode = '22023';
  end if;
  select * into entrant from public.swiss_entrants
   where phase_id = p_phase and registration_id = p_registration;
  if not found then
    raise exception 'registration % is not in swiss phase %', p_registration, p_phase
      using errcode = 'P0002';
  end if;
  if entrant.withdrawn_at_round is null then
    return jsonb_build_object('status', 'in', 'missedRounds', to_jsonb(entrant.missed_rounds));
  end if;
  -- Read under the phase lock: a settle that put the Fighter out committed its status before its
  -- reconcile asks for the withdraw, which waits on this lock; so either order converges. Out is
  -- `out_since` set: 0240's CHECK ties it to the status, so the out statuses are not typed again.
  select status, out_since is not null into fighter_status, fighter_out
    from public.registrations where id = p_registration;
  if fighter_out then
    if p_by = 'hand' then
      raise exception 'fighter_out: registration % is %', p_registration, fighter_status
        using errcode = 'P0001';
    end if;
    return jsonb_build_object('status', 'kept', 'missedRounds', to_jsonb(entrant.missed_rounds));
  end if;
  select coalesce(max(round_number), 0) into last_round
    from public.swiss_rounds where phase_id = p_phase;
  if p_by = 'status' then
    -- Only the organiser undoes a hand withdrawal; a phase that is over is left alone (125); a
    -- round paired without the Fighter keeps them out until the organiser puts them back (81).
    if entrant.withdrawn_by = 'hand' or public.swiss_phase_over(p_phase)
       or last_round >= entrant.withdrawn_at_round then
      return jsonb_build_object('status', 'kept', 'missedRounds', to_jsonb(entrant.missed_rounds));
    end if;
    missed := entrant.missed_rounds;
  else
    -- The rounds paired while they were withdrawn: they take no part in them (121).
    missed := entrant.missed_rounds
      || coalesce(array(select generate_series(entrant.withdrawn_at_round, last_round)), '{}');
  end if;
  update public.swiss_entrants
     set withdrawn_at_round = null, withdrawn_by = null, missed_rounds = missed
   where id = entrant.id;
  return jsonb_build_object('status', 'put_back', 'missedRounds', to_jsonb(missed));
end;
$$;

-- Deletes the last round when nothing in it has started and no live cause of a Fighter's status
-- sits on its bouts, and forgets its number from every entrant's missed rounds, in one step.
-- Answers {matches}: the bouts deleted. Refusals: P0002 (no round), 'not_last_round: <n>',
-- 'round_under_way', 'round_has_records' (P0001).
create or replace function public.swiss_delete_last_round(
  p_phase uuid,
  p_round integer,
  p_fought text[]
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_catalog
as $$
declare
  phase_row uuid;
  last_round integer;
  round_row uuid;
  deleted integer;
begin
  select id into phase_row from public.phases where id = p_phase and type = 'swiss' for no key update;
  if not found then
    raise exception 'swiss phase % not found', p_phase using errcode = 'P0002';
  end if;
  select max(round_number) into last_round from public.swiss_rounds where phase_id = p_phase;
  if last_round is null then
    raise exception 'swiss phase % has no rounds', p_phase using errcode = 'P0002';
  end if;
  if p_round is distinct from last_round then
    raise exception 'not_last_round: %', last_round using errcode = 'P0001';
  end if;
  select id into round_row from public.swiss_rounds
   where phase_id = p_phase and round_number = p_round;
  -- A pad Start of one of these bouts waits here, then finds no row: never a running bout deleted.
  perform 1 from public.matches where swiss_round_id = round_row for update;
  if exists (select 1 from public.matches
              where swiss_round_id = round_row and status = any (coalesce(p_fought, '{}'))) then
    raise exception 'round_under_way' using errcode = 'P0001';
  end if;
  -- Its cascade would take a live cause of a Fighter's status with no settle (0240). Through the
  -- API a live forfeit completes its bout, so 'round_under_way' answers first: the forfeit half
  -- guards a direct write (the web door, ruling 98) and an edited archive.
  if exists (select 1 from public.match_penalties p join public.matches m on m.id = p.match_id
              where m.swiss_round_id = round_row and p.card = 'black' and not p.voided)
     or exists (select 1 from public.match_forfeits f join public.matches m on m.id = f.match_id
                 where m.swiss_round_id = round_row and f.voided_at is null) then
    raise exception 'round_has_records' using errcode = 'P0001';
  end if;
  -- The bouts first: `matches.swiss_round_id` is SET NULL, and a bout left behind loses its round.
  delete from public.matches where swiss_round_id = round_row;
  get diagnostics deleted = row_count;
  delete from public.swiss_rounds where id = round_row;
  update public.swiss_entrants
     set missed_rounds = array_remove(missed_rounds, p_round)
   where phase_id = p_phase and p_round = any (missed_rounds);
  return jsonb_build_object('matches', deleted);
end;
$$;

comment on function public.swiss_phase_over(uuid) is
  'True when a status change no longer touches the Swiss phase: finalised, or its last configured round paired and fought (rulings 125, 126).';
comment on function public.swiss_put_back(uuid, uuid, text) is
  'Puts a withdrawn entrant back in the pairings of a Swiss phase, under the phase''s row lock: by the status reconcile (unless by hand, over, or a round was paired without them) or by the organiser (the rounds missed recorded). Answers {status, missedRounds}.';
comment on function public.swiss_delete_last_round(uuid, integer, text[]) is
  'Deletes the last round of a Swiss phase and forgets its number from the missed rounds, in one step under the phase''s row lock. Answers {matches}.';

revoke execute on function public.swiss_phase_over(uuid) from public, anon, authenticated;
grant execute on function public.swiss_phase_over(uuid) to service_role;
revoke execute on function public.swiss_put_back(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.swiss_put_back(uuid, uuid, text) to service_role;
revoke execute on function public.swiss_delete_last_round(uuid, integer, text[])
  from public, anon, authenticated;
grant execute on function public.swiss_delete_last_round(uuid, integer, text[]) to service_role;

-- ── Prove what landed ────────────────────────────────────────────────────────
DO $$
DECLARE
  def TEXT;
  body TEXT;
  fn regprocedure;
  over CONSTANT regprocedure := 'public.swiss_phase_over(uuid)';
  locked CONSTANT TEXT[] := ARRAY[
    'public.swiss_withdraw(uuid, uuid, text)',
    'public.swiss_put_back(uuid, uuid, text)',
    'public.swiss_delete_last_round(uuid, integer, text[])'
  ];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'public.swiss_entrants'::regclass
     AND conname = 'swiss_entrants_missed_rounds_valid';
  IF def IS DISTINCT FROM
     'CHECK (((COALESCE(array_ndims(missed_rounds), 1) = 1) AND (array_position(missed_rounds, NULL::integer) IS NULL) AND (1 <= ALL (missed_rounds))))' THEN
    RAISE EXCEPTION '0244: swiss_entrants_missed_rounds_valid is %', def;
  END IF;

  FOREACH def IN ARRAY locked || ARRAY['public.swiss_phase_over(uuid)'] LOOP
    fn := def::regprocedure;
    IF has_function_privilege('anon', fn, 'EXECUTE')
       OR has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '0244: a web role may execute %', fn;
    END IF;
    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '0244: the service role may not execute %', fn;
    END IF;
    IF (SELECT provolatile FROM pg_proc WHERE oid = fn) <> 'v' THEN
      RAISE EXCEPTION '0244: % is not VOLATILE', fn;
    END IF;
  END LOOP;

  -- The three that write lock the phase as their FIRST statement (the text pin, see the header).
  FOREACH def IN ARRAY locked LOOP
    fn := def::regprocedure;
    SELECT substring(prosrc FROM '\ybegin\y(.*)$') INTO body FROM pg_proc WHERE oid = fn;
    IF body IS NULL OR body !~* '^\s*select\y[^;]*\yfrom\s+public\.phases\y[^;]*\yfor\s+no\s+key\s+update\s*;' THEN
      RAISE EXCEPTION '0244: % does not lock the phase first', fn;
    END IF;
  END LOOP;
  -- "Over" takes no lock, and is the one owner of its rule: both writers ask it.
  IF (SELECT prosrc FROM pg_proc WHERE oid = over) ~* '\yfor\s+(no\s+key\s+)?update\y' THEN
    RAISE EXCEPTION '0244: swiss_phase_over takes a lock';
  END IF;
  FOREACH def IN ARRAY ARRAY['public.swiss_withdraw(uuid, uuid, text)',
                             'public.swiss_put_back(uuid, uuid, text)'] LOOP
    IF (SELECT prosrc FROM pg_proc WHERE oid = def::regprocedure) !~* '\yswiss_phase_over\s*\(' THEN
      RAISE EXCEPTION '0244: % does not ask swiss_phase_over', def;
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
