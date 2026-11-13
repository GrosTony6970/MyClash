-- 0270: FightBook, slice 5 — the floor tools: Free to spar now, open calls, log by QR scan
-- (rulings 705-714; the slice 5 plan's Decisions 1, 4, 7, 9-12b).
--
-- 1. `fightbook_free_now`: a fighter is free to spar now at one Event, until `until` (at most an
--    hour, never past the end of the Event day). One row per profile: one venue at a time. A table
--    of its own, never columns on `global_persons`: presence must not ride on a profile row other
--    reads select. Every read requires `until > now()`; the hourly job deletes the rest.
--
-- 2. `spar_open_calls`: "who spars with me at 14:00?" posted to an Event day (ruling 710: several
--    at once). OPEN is `status = 'open' AND closes_at > now()`: nothing flips the status at
--    `closes_at`, every read and the pick test that clause. `picked` names the chosen fighter and
--    the spar the pick made (the spar outlives the call: ON DELETE SET NULL).
--
-- 3. `spar_open_call_answers`: one "I'm in" per fighter per call. Only the poster reads who
--    answered (ruling 712).
--
-- 4. `fightbook_qr_codes`: a code shown on a phone, five minutes, one scan (ruling 711). The row
--    holds the sha256 hex of the raw code, never the code.
--
-- The functions, each one database call. The 0264 pair lock is an advisory lock on the unordered
-- pair, then KEY SHARE on both profiles in id order. fightbook_call_pick and fightbook_block take
-- it before they read. fightbook_qr_log claims the code row FIRST (the code names the shower) and
-- takes the pair lock right after. fightbook_answer takes none, as in 0264:
--   - fightbook_call_pick: the poster picks one answer. The answer row is held FOR SHARE (a take
--     back waits or loses); both profiles live with FightBook on and no block either way, else
--     `not_open`. Then ONE conditional update is the only gate on the call's state: zero rows is
--     `not_open`, so two picks at once make one spar. The spar is stored agreed, asker = poster.
--   - fightbook_call_take_back: an answerer takes back "I'm in". It locks the answer row FOR
--     UPDATE first, so it waits on a pick's FOR SHARE, then reads the call in a new statement: a
--     pick that committed meanwhile makes it `not_open`, never a take-back AND a spar. No answer
--     row is `not_found` (P0002; the API answers it as an unknown call). Takes no pair lock: it
--     reads no profile and no block (ruling 672).
--   - fightbook_qr_log: the scanner asks the shower (rulings 707, 713). The code row is deleted
--     FIRST: of two scans at once one finds it, the other answers `bad_code`. Every later refusal
--     raises, which undoes the delete, so a refused scan leaves the code usable. Then 0264's ask
--     checks in 0264's order, minus the no-asking-twice rule (she is showing her code), with the
--     request's shape refused as `bad_event` (a malformed call answers a word, not a 23514). The
--     request is ALWAYS stored pending (ruling 714): a scan by a fighter the shower blocked waits
--     as "sent" and ends "Not this time" with its day, exactly like a request she ignored.
--     `notify` (false for that scan) tells the API whether to send the notice.
--
-- Re-defined from 0264 (no later migration replaced them):
--   - fightbook_block also deletes the blocker's answers on the blocked fighter's calls (the
--     blocker withdrew). The blocked fighter's answers on the blocker's calls stay; the blocker's
--     read leaves them out, and they show again on an unblock.
--   - fightbook_answer refuses `not_open` when the receiver blocked the asker: a blocked scan's
--     request is pending and hidden from her Inbox, and no stray id may agree a spar with it.
--     The request row's lock orders it against fightbook_block, which updates that same row.
--
-- Deny-all: RLS on, no policy; the API reads and writes these as the service role (0247). Every
-- CHECK is a CASE with ELSE false: a CHECK written as an OR of comparisons reads NULL and passes.
-- SECURITY INVOKER, search_path pinned, service role only (the 0264 shape).

CREATE TABLE IF NOT EXISTS public.fightbook_free_now (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  global_person_id UUID NOT NULL REFERENCES public.global_persons(id) ON DELETE CASCADE,
  event_id         UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  until            TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fightbook_free_now_person_uk UNIQUE (global_person_id)
);

COMMENT ON TABLE public.fightbook_free_now IS
  'FightBook: a fighter free to spar now at one Event, until a time. Deny-all; API only.';

CREATE INDEX IF NOT EXISTS fightbook_free_now_event_idx
  ON public.fightbook_free_now (event_id);

ALTER TABLE public.fightbook_free_now ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.spar_open_calls (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poster_global_person_id UUID NOT NULL REFERENCES public.global_persons(id) ON DELETE CASCADE,
  event_id                UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  spar_day                DATE NOT NULL,
  zone                    TEXT NOT NULL,
  spar_time               TIME NOT NULL,
  weapons                 TEXT[] NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'open',
  picked_global_person_id UUID REFERENCES public.global_persons(id) ON DELETE CASCADE,
  spar_request_id         UUID REFERENCES public.spar_requests(id) ON DELETE SET NULL,
  closes_at               TIMESTAMPTZ NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT spar_open_calls_weapons CHECK (
    CASE WHEN cardinality(weapons) BETWEEN 1 AND 5 THEN true ELSE false END),
  CONSTRAINT spar_open_calls_status_shape CHECK (
    CASE status
      WHEN 'open' THEN picked_global_person_id IS NULL AND spar_request_id IS NULL
      WHEN 'closed' THEN picked_global_person_id IS NULL AND spar_request_id IS NULL
      WHEN 'picked' THEN picked_global_person_id IS NOT NULL
      ELSE false END)
);

COMMENT ON TABLE public.spar_open_calls IS
  'FightBook: a fighter''s open call for a spar at an Event day and time. Deny-all; API only.';

CREATE INDEX IF NOT EXISTS spar_open_calls_event_idx
  ON public.spar_open_calls (event_id, spar_day, status);
CREATE INDEX IF NOT EXISTS spar_open_calls_poster_idx
  ON public.spar_open_calls (poster_global_person_id, spar_day);
CREATE INDEX IF NOT EXISTS spar_open_calls_picked_idx
  ON public.spar_open_calls (picked_global_person_id);
CREATE INDEX IF NOT EXISTS spar_open_calls_spar_request_idx
  ON public.spar_open_calls (spar_request_id);

ALTER TABLE public.spar_open_calls ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.spar_open_call_answers (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id                   UUID NOT NULL REFERENCES public.spar_open_calls(id) ON DELETE CASCADE,
  answerer_global_person_id UUID NOT NULL REFERENCES public.global_persons(id) ON DELETE CASCADE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT spar_open_call_answers_pair_uk UNIQUE (call_id, answerer_global_person_id)
);

COMMENT ON TABLE public.spar_open_call_answers IS
  'FightBook: one "I''m in" per fighter on an open call; only the poster reads who. Deny-all; API only.';

CREATE INDEX IF NOT EXISTS spar_open_call_answers_answerer_idx
  ON public.spar_open_call_answers (answerer_global_person_id);

ALTER TABLE public.spar_open_call_answers ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.fightbook_qr_codes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash       TEXT NOT NULL,
  global_person_id UUID NOT NULL REFERENCES public.global_persons(id) ON DELETE CASCADE,
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fightbook_qr_codes_token_hash_uk UNIQUE (token_hash),
  CONSTRAINT fightbook_qr_codes_hash CHECK (
    CASE WHEN token_hash ~ '^[0-9a-f]{64}$' THEN true ELSE false END)
);

COMMENT ON TABLE public.fightbook_qr_codes IS
  'FightBook: a spar QR code (sha256 hex only), five minutes, one scan. Deny-all; API only.';

CREATE INDEX IF NOT EXISTS fightbook_qr_codes_person_idx
  ON public.fightbook_qr_codes (global_person_id);

ALTER TABLE public.fightbook_qr_codes ENABLE ROW LEVEL SECURITY;

create or replace function public.fightbook_call_pick(
  p_call       uuid,
  p_poster     uuid,
  p_answerer   uuid,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
volatile
set search_path = public, pg_catalog
as $$
declare
  v_event   uuid;
  v_day     date;
  v_zone    text;
  v_time    time;
  v_weapons text[];
  v_spar    uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    least(p_poster, p_answerer)::text || greatest(p_poster, p_answerer)::text, 0));
  perform 1 from public.global_persons
   where id in (p_poster, p_answerer)
   order by id for key share;

  -- The answer stays until the pick commits: a take-back waits, or won first and the pick loses.
  perform 1 from public.spar_open_call_answers a
   where a.call_id = p_call and a.answerer_global_person_id = p_answerer
   for share;
  if not found then
    raise exception 'not_open' using errcode = 'P0001';
  end if;

  if p_poster = p_answerer
     or not exists (
       select 1 from public.global_persons g
        where g.id = p_poster and g.fightbook_enabled and g.claimed_by_user_id is not null
          and g.merged_into_id is null and g.deleted_at is null and g.account_deleted_at is null)
     or not exists (
       select 1 from public.global_persons g
        where g.id = p_answerer and g.fightbook_enabled and g.claimed_by_user_id is not null
          and g.merged_into_id is null and g.deleted_at is null and g.account_deleted_at is null)
     or exists (
       select 1 from public.fightbook_blocks b
        where (b.blocker_global_person_id = p_poster and b.blocked_global_person_id = p_answerer)
           or (b.blocker_global_person_id = p_answerer and b.blocked_global_person_id = p_poster))
  then
    raise exception 'not_open' using errcode = 'P0001';
  end if;

  -- The only gate on the call's state: no pre-check could let a second pick through on its own.
  update public.spar_open_calls c
     set status = 'picked',
         picked_global_person_id = p_answerer
   where c.id = p_call
     and c.poster_global_person_id = p_poster
     and c.status = 'open'
     and c.closes_at > now()
  returning c.event_id, c.spar_day, c.zone, c.spar_time, c.weapons
       into v_event, v_day, v_zone, v_time, v_weapons;
  if not found then
    raise exception 'not_open' using errcode = 'P0001';
  end if;

  insert into public.spar_requests (
    asker_global_person_id, receiver_global_person_id, kind, event_id, spar_day, zone,
    spar_time, weapons, status, agreed_at, expires_at)
  values (
    p_poster, p_answerer, 'event', v_event, v_day, v_zone,
    v_time, v_weapons, 'agreed', now(), p_expires_at)
  returning id into v_spar;

  update public.spar_open_calls c
     set spar_request_id = v_spar
   where c.id = p_call;

  return v_spar;
end;
$$;

revoke all on function public.fightbook_call_pick(uuid, uuid, uuid, timestamptz) from public;
revoke execute on function public.fightbook_call_pick(uuid, uuid, uuid, timestamptz) from anon, authenticated;
grant execute on function public.fightbook_call_pick(uuid, uuid, uuid, timestamptz) to service_role;

create or replace function public.fightbook_call_take_back(
  p_call     uuid,
  p_answerer uuid
)
returns void
language plpgsql
volatile
set search_path = public, pg_catalog
as $$
begin
  -- The answer row first, FOR UPDATE: a pick holding it FOR SHARE makes this wait until the pick
  -- ends (the pick's order: the answer, then the call). A take-back that locked it first deletes
  -- it, and the pick then finds no answer and refuses.
  perform 1 from public.spar_open_call_answers a
   where a.call_id = p_call and a.answerer_global_person_id = p_answerer
   for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- A new statement, so a new snapshot: it reads the call as a pick that just committed left it.
  if not exists (
    select 1 from public.spar_open_calls c
     where c.id = p_call and c.status = 'open' and c.closes_at > now()
  ) then
    raise exception 'not_open' using errcode = 'P0001';
  end if;

  delete from public.spar_open_call_answers a
   where a.call_id = p_call and a.answerer_global_person_id = p_answerer;
end;
$$;

revoke all on function public.fightbook_call_take_back(uuid, uuid) from public;
revoke execute on function public.fightbook_call_take_back(uuid, uuid) from anon, authenticated;
grant execute on function public.fightbook_call_take_back(uuid, uuid) to service_role;

create or replace function public.fightbook_qr_log(
  p_token_hash text,
  p_scanner    uuid,
  p_kind       text,
  p_event_id   uuid,
  p_spar_day   date,
  p_zone       text,
  p_place      text,
  p_weapons    text[],
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
volatile
set search_path = public, pg_catalog
as $$
declare
  v_shower uuid;
  v_id     uuid;
  v_notify boolean;
begin
  -- First: of two scans at once, one deletes the row and the other finds none. Every refusal
  -- below raises, which undoes this delete, so the code stays usable.
  -- Lock order: the code row is locked BEFORE the pair lock's KEY SHARE on the two profiles. Its
  -- one partner in the other order is a hard DELETE FROM global_persons of the shower, whose
  -- cascade into fightbook_qr_codes can deadlock with a scan (40P01, one side aborted). Decision
  -- 12 mandates delete-first, and erasure must delete the QR codes before the profile, in this
  -- order (Decision 18). Do not add a second partner: whatever locks a profile and then a code row
  -- is one.
  delete from public.fightbook_qr_codes q
   where q.token_hash = p_token_hash and q.expires_at > now()
  returning q.global_person_id into v_shower;
  if v_shower is null then
    raise exception 'bad_code' using errcode = 'P0001';
  end if;

  if p_scanner = v_shower then
    raise exception 'self' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    least(p_scanner, v_shower)::text || greatest(p_scanner, v_shower)::text, 0));
  perform 1 from public.global_persons
   where id in (p_scanner, v_shower)
   order by id for key share;

  if not exists (
    select 1 from public.global_persons g
     where g.id = p_scanner and g.fightbook_enabled and g.claimed_by_user_id is not null
       and g.merged_into_id is null and g.deleted_at is null and g.account_deleted_at is null
  ) then
    raise exception 'fightbook_off' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.global_persons g
     where g.id = v_shower and g.fightbook_enabled and g.claimed_by_user_id is not null
       and g.merged_into_id is null and g.deleted_at is null and g.account_deleted_at is null
  ) then
    raise exception 'not_on_fightbook' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.fightbook_blocks b
     where b.blocker_global_person_id = p_scanner and b.blocked_global_person_id = v_shower
  ) then
    raise exception 'you_blocked' using errcode = 'P0001';
  end if;

  -- The request's shape (0263's spar_requests_kind_shape), refused as a word rather than a 23514.
  -- An Event spar needs the shower on that Event's roster (the API checks the scanner's); a NULL
  -- Event matches no roster row. A free-date spar names no Event and a place.
  -- In parentheses: plpgsql's IF reads its condition up to the first THEN outside them.
  if (case p_kind
        when 'event' then p_place is not null or not exists (
          select 1 from public.persons p
           where p.event_id = p_event_id and p.global_person_id = v_shower)
        when 'free' then p_event_id is not null or btrim(coalesce(p_place, '')) = ''
        else true end)
  then
    raise exception 'bad_event' using errcode = 'P0001';
  end if;

  update public.spar_requests r
     set status = 'not_this_time'
   where r.asker_global_person_id = p_scanner and r.receiver_global_person_id = v_shower
     and r.status = 'pending' and r.expires_at <= now();

  if exists (
    select 1 from public.spar_requests r
     where r.asker_global_person_id = p_scanner and r.receiver_global_person_id = v_shower
       and r.status = 'pending'
  ) then
    raise exception 'already_asked' using errcode = 'P0001';
  end if;

  v_notify := not exists (
    select 1 from public.fightbook_blocks b
     where b.blocker_global_person_id = v_shower and b.blocked_global_person_id = p_scanner
  );

  -- Pending always (ruling 714), whoever blocked whom: the face of an ask she ignored.
  insert into public.spar_requests (
    asker_global_person_id, receiver_global_person_id, kind, event_id, spar_day, zone,
    place, weapons, status, expires_at)
  values (
    p_scanner, v_shower, p_kind, p_event_id, p_spar_day, p_zone,
    p_place, p_weapons, 'pending', p_expires_at)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'notify', v_notify);
end;
$$;

revoke all on function public.fightbook_qr_log(text, uuid, text, uuid, date, text, text, text[], timestamptz) from public;
revoke execute on function public.fightbook_qr_log(text, uuid, text, uuid, date, text, text, text[], timestamptz) from anon, authenticated;
grant execute on function public.fightbook_qr_log(text, uuid, text, uuid, date, text, text, text[], timestamptz) to service_role;

create or replace function public.fightbook_answer(
  p_request        uuid,
  p_receiver       uuid,
  p_answer         text,
  p_comment        text,
  p_comment_shared boolean
)
returns jsonb
language plpgsql
volatile
set search_path = public, pg_catalog
as $$
declare
  v_status  text;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_shared  boolean := coalesce(p_comment_shared, false);
  v_asker   uuid;
begin
  v_status := case p_answer when 'yes' then 'agreed' when 'no' then 'not_this_time' end;
  if v_status is null then
    raise exception 'bad_answer' using errcode = 'P0001';
  end if;

  update public.spar_requests r
     set status = v_status,
         agreed_at = case when v_status = 'agreed' then now() end,
         shared_comment = case when v_status = 'not_this_time' and v_shared then v_comment end
   where r.id = p_request
     and r.receiver_global_person_id = p_receiver
     and r.status = 'pending'
     and r.expires_at > now()
     and exists (
       select 1 from public.global_persons g
        where g.id = r.asker_global_person_id and g.fightbook_enabled
          and g.claimed_by_user_id is not null and g.merged_into_id is null
          and g.deleted_at is null and g.account_deleted_at is null)
     and not exists (
       select 1 from public.fightbook_blocks b
        where b.blocker_global_person_id = p_receiver
          and b.blocked_global_person_id = r.asker_global_person_id)
  returning r.asker_global_person_id into v_asker;

  if v_asker is null then
    raise exception 'not_open' using errcode = 'P0001';
  end if;

  if v_status = 'not_this_time' and not v_shared and v_comment is not null then
    insert into public.spar_private_notes (spar_request_id, author_global_person_id, body)
    values (p_request, p_receiver, v_comment);
  end if;

  return jsonb_build_object('asker', v_asker, 'status', v_status);
end;
$$;

revoke all on function public.fightbook_answer(uuid, uuid, text, text, boolean) from public;
revoke execute on function public.fightbook_answer(uuid, uuid, text, text, boolean) from anon, authenticated;
grant execute on function public.fightbook_answer(uuid, uuid, text, text, boolean) to service_role;

create or replace function public.fightbook_block(
  p_blocker uuid,
  p_blocked uuid
)
returns void
language plpgsql
volatile
set search_path = public, pg_catalog
as $$
begin
  if p_blocker = p_blocked then
    raise exception 'self' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    least(p_blocker, p_blocked)::text || greatest(p_blocker, p_blocked)::text, 0));
  perform 1 from public.global_persons
   where id in (p_blocker, p_blocked)
   order by id for key share;

  -- A live profile only, as the ask and the answer test it: a block on a merged-away or deleted
  -- profile, or one whose account was erased, would hold nothing.
  if not exists (
    select 1 from public.global_persons
     where id = p_blocked and merged_into_id is null and deleted_at is null
       and account_deleted_at is null
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  insert into public.fightbook_blocks (blocker_global_person_id, blocked_global_person_id)
  values (p_blocker, p_blocked)
  on conflict (blocker_global_person_id, blocked_global_person_id) do nothing;

  update public.spar_requests
     set status = 'not_this_time'
   where asker_global_person_id = p_blocked and receiver_global_person_id = p_blocker
     and status = 'pending';

  update public.spar_requests
     set status = 'withdrawn'
   where asker_global_person_id = p_blocker and receiver_global_person_id = p_blocked
     and status = 'pending';

  -- The blocker withdraws from the blocked fighter's calls, as from their own pending requests.
  delete from public.spar_open_call_answers a
   using public.spar_open_calls c
   where a.call_id = c.id
     and c.poster_global_person_id = p_blocked
     and a.answerer_global_person_id = p_blocker;
end;
$$;

revoke all on function public.fightbook_block(uuid, uuid) from public;
revoke execute on function public.fightbook_block(uuid, uuid) from anon, authenticated;
grant execute on function public.fightbook_block(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
