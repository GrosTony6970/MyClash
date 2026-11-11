-- 0264: FightBook, slice 1 — the three calls that must win a race, each ONE database call.
--
-- Two taps can race on every FightBook state change: an ask against a block, a Yes against a
-- withdraw or the end of the day, two Yes taps. Each is one function body, one transaction, and
-- the loser gets a refusal word the API answers (P0001, the word as message; P0002 not found).
--
-- fightbook_ask: the rules of asking, in this order.
--   - self: nobody asks themselves.
--   - The pair is serialised: an advisory lock on the unordered pair (two asks, or an ask and a
--     block, between the same two fighters run one after the other). Then a KEY SHARE lock on both
--     profiles, in id order: a merge's FOR UPDATE (0212) then waits for the ask, or the ask for the
--     merge, never each for the other (the insert would otherwise take that lock late, behind the
--     merge, while the merge waits on the insert's pending-pair index entry).
--   - fightbook_off: the asker's profile is not live (merged, deleted, account erased, unclaimed)
--     or has FightBook off. not_on_fightbook: the same for the receiver.
--   - you_blocked: the asker blocked the receiver.
--   - The pair's requests past their end are ended first (the hourly job may not have run yet), so
--     a stale one neither counts as waiting nor escapes the no-asking-twice rule.
--   - already_asked: one waiting request per asker and receiver (the 0263 unique index backs it).
--   - not_again: after a "Not this time", not for the same Event again; for a free date, not until
--     7 days after the refused request was asked (ruling 667: counted from the refused DAY, a no
--     to a day 11 months out would bar asking for 11 months). No decline time is stored (0263),
--     and none is needed.
--   - A receiver who blocked the asker: the request is stored ended, as "Not this time", and the
--     call answers as it does for any ask. The receiver never sees it.
--
-- fightbook_answer: one conditional update. It lands only on the receiver's own request, still
-- waiting, before the end of its day, from an asker still live with FightBook on (an asker who
-- switched off is not agreed to behind their back). A Yes keeps no comment. A "Not this time"
-- comment the decliner shows goes on the row; one they keep goes to spar_private_notes, never on
-- the row the asker's data download carries.
--
-- fightbook_block: the same pair lock. The blocked fighter's waiting requests to the blocker end as
-- "Not this time", like any no. The blocker's own waiting request to them is WITHDRAWN: a "Not this
-- time" there would show the blocked fighter, in their own data download, a refusal nobody gave.
-- An agreed spar stays: either of them cancels it the ordinary way. Only a live profile may be
-- blocked (not merged away, not deleted, account not erased): a block on any other holds nothing.
--
-- SECURITY INVOKER, search_path pinned, service role only (the 0190 / 0207 / 0212 pattern): the API
-- calls these as the service role; anon and authenticated are revoked by name (0184).

create or replace function public.fightbook_ask(
  p_asker      uuid,
  p_receiver   uuid,
  p_kind       text,
  p_event_id   uuid,
  p_spar_day   date,
  p_zone       text,
  p_spar_time  time,
  p_place      text,
  p_weapons    text[],
  p_message    text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
volatile
set search_path = public, pg_catalog
as $$
declare
  v_status text;
  v_id     uuid;
begin
  if p_asker = p_receiver then
    raise exception 'self' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    least(p_asker, p_receiver)::text || greatest(p_asker, p_receiver)::text, 0));
  perform 1 from public.global_persons
   where id in (p_asker, p_receiver)
   order by id for key share;

  if not exists (
    select 1 from public.global_persons g
     where g.id = p_asker and g.fightbook_enabled and g.claimed_by_user_id is not null
       and g.merged_into_id is null and g.deleted_at is null and g.account_deleted_at is null
  ) then
    raise exception 'fightbook_off' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.global_persons g
     where g.id = p_receiver and g.fightbook_enabled and g.claimed_by_user_id is not null
       and g.merged_into_id is null and g.deleted_at is null and g.account_deleted_at is null
  ) then
    raise exception 'not_on_fightbook' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.fightbook_blocks b
     where b.blocker_global_person_id = p_asker and b.blocked_global_person_id = p_receiver
  ) then
    raise exception 'you_blocked' using errcode = 'P0001';
  end if;

  update public.spar_requests r
     set status = 'not_this_time'
   where r.asker_global_person_id = p_asker and r.receiver_global_person_id = p_receiver
     and r.status = 'pending' and r.expires_at <= now();

  if exists (
    select 1 from public.spar_requests r
     where r.asker_global_person_id = p_asker and r.receiver_global_person_id = p_receiver
       and r.status = 'pending'
  ) then
    raise exception 'already_asked' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.spar_requests r
     where r.asker_global_person_id = p_asker and r.receiver_global_person_id = p_receiver
       and r.status = 'not_this_time'
       and case p_kind
             when 'event' then r.kind = 'event' and r.event_id = p_event_id
             when 'free' then r.kind = 'free' and r.created_at > now() - interval '7 days'
             else false end
  ) then
    raise exception 'not_again' using errcode = 'P0001';
  end if;

  v_status := case when exists (
    select 1 from public.fightbook_blocks b
     where b.blocker_global_person_id = p_receiver and b.blocked_global_person_id = p_asker
  ) then 'not_this_time' else 'pending' end;

  insert into public.spar_requests (
    asker_global_person_id, receiver_global_person_id, kind, event_id, spar_day, zone,
    spar_time, place, weapons, message, status, expires_at)
  values (
    p_asker, p_receiver, p_kind, p_event_id, p_spar_day, p_zone,
    p_spar_time, p_place, p_weapons, p_message, v_status, p_expires_at)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'status', v_status);
end;
$$;

revoke all on function public.fightbook_ask(uuid, uuid, text, uuid, date, text, time, text, text[], text, timestamptz) from public;
revoke execute on function public.fightbook_ask(uuid, uuid, text, uuid, date, text, time, text, text[], text, timestamptz) from anon, authenticated;
grant execute on function public.fightbook_ask(uuid, uuid, text, uuid, date, text, time, text, text[], text, timestamptz) to service_role;

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
end;
$$;

revoke all on function public.fightbook_block(uuid, uuid) from public;
revoke execute on function public.fightbook_block(uuid, uuid) from anon, authenticated;
grant execute on function public.fightbook_block(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
