-- 0271: FightBook, slice 6 — a daily limit: "At most N spars a day" (rulings 741-744, 747; the
-- slice 6 plan's Decisions 1-5).
--
-- 1. `fightbook_daily_limits`: one row per profile that set a limit; no row = no limit. A table of
--    its own, never a column on `global_persons`: policy 0187 lets anyone read a listed fighter's
--    row, and a readable limit would let an asker tell "an instant no from a fighter with no
--    limit" for what it is, a block (ruling 660). 1 to 20: 20 matches the ask throttle (20 asks
--    an hour), and 0 is FightBook off, which already exists. `updated_at` is set by every write.
--    Deny-all: RLS on, no policy (0247); the API reads and writes it as the service role. Its
--    owner reads it in her settings; fightbook_ask reads it here; nothing else does.
--
-- 2. fightbook_ask, re-defined from 0264 (no later migration replaced it). WHAT CHANGES: the line
--    that picks the stored status. A new ask is stored ended, "Not this time", when the receiver
--    blocked the asker (0264) OR she has a limit and her count for the asked day is at least that
--    limit. Her count (rulings 741, 744): her spars as asker OR receiver on that `spar_day` that
--    are `agreed` or `done`, an Event spar and a free-date spar alike. A cancelled one does not
--    count, so a cancel frees a place for the asks that come after it. The block and the limit are
--    each worked out into a variable first, then the status decided: a blocked ask does the same
--    work as any other. The clause runs after not_again and already_asked, as the block does, so
--    a limit-stopped ask is the same row as a declined one, answered the same `{ id }` (ruling
--    672), and the no-asking-twice rule follows it: the asker the limit stopped cannot ask her
--    again at that Event, any day of it, even after a cancel frees a place (ruling 747). The limit
--    answers only NEW asks to her (742): her Yes on a waiting ask, a QR scan of her code, a pick
--    from her "I'm in" and her own asks never read it (743). fightbook_answer, fightbook_call_pick
--    and fightbook_qr_log are not touched.
--
--    THE RACE IT LEAVES, ACCEPTED (Decision 4). An ask that counts while one of her Yes taps
--    commits can land pending past her limit. She answers it herself, and ruling 742 lets every
--    Yes through, so no lock is taken on her day: no Yes is ever capped.
--
-- 3. merge_fighters, re-defined from 0268 (no later migration replaced it). WHAT CHANGES: one
--    statement after the survivor's profile update. The survivor keeps the stricter limit, as it
--    keeps the stricter switches (0265, 0268): the merged profile's limit is inserted onto the
--    survivor, the lower one wins on a conflict. The merged profile's own row stays where nothing
--    reads it (0268's doubled favourites rule). No record key: nothing moved. revert_fighter_merge
--    is not touched (0268's star switch rule): a reverted survivor keeps the stricter limit.
--
-- Everything else in both functions, the locks, the refusals, the record, the rights, is 0264's
-- and 0268's, word for word. SECURITY INVOKER, search_path pinned, service role only.

CREATE TABLE IF NOT EXISTS public.fightbook_daily_limits (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  global_person_id UUID NOT NULL REFERENCES public.global_persons(id) ON DELETE CASCADE,
  daily_limit      SMALLINT NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fightbook_daily_limits_person_uk UNIQUE (global_person_id),
  CONSTRAINT fightbook_daily_limits_range CHECK (
    CASE WHEN daily_limit BETWEEN 1 AND 20 THEN true ELSE false END)
);

COMMENT ON TABLE public.fightbook_daily_limits IS
  'FightBook: a fighter''s "at most N spars a day" (no row = no limit). Deny-all; API only.';

ALTER TABLE public.fightbook_daily_limits ENABLE ROW LEVEL SECURITY;

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
  v_blocked boolean;
  v_full    boolean;
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

  v_blocked := exists (
    select 1 from public.fightbook_blocks b
     where b.blocker_global_person_id = p_receiver and b.blocked_global_person_id = p_asker
  );

  -- Her live spars that day, either side (never both: spar_requests_two_fighters), against her
  -- limit. No row, no limit. The (asker|receiver, status, spar_day) indexes serve each count.
  v_full := coalesce((
    select l.daily_limit <= (
             (select count(*) from public.spar_requests r
               where r.asker_global_person_id = p_receiver
                 and r.status in ('agreed', 'done') and r.spar_day = p_spar_day)
           + (select count(*) from public.spar_requests r
               where r.receiver_global_person_id = p_receiver
                 and r.status in ('agreed', 'done') and r.spar_day = p_spar_day))
      from public.fightbook_daily_limits l
     where l.global_person_id = p_receiver
  ), false);

  v_status := case when v_blocked or v_full then 'not_this_time' else 'pending' end;

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

create or replace function public.merge_fighters(
  p_source_id         uuid,
  p_target_id         uuid,
  p_actor_user_id     uuid,
  p_reason            text,
  p_source_snapshot   jsonb,
  p_target_snapshot   jsonb
)
returns jsonb
language plpgsql
volatile
set search_path = public, pg_catalog
as $$
declare
  v_source         public.global_persons;
  v_target         public.global_persons;
  v_claim          uuid;
  v_followers      uuid[];
  v_person_ids     uuid[];
  v_instructor_ids uuid[];
  v_moved          jsonb;
  v_spar_asker     uuid[];
  v_spar_receiver  uuid[];
  v_block_blocker  uuid[];
  v_block_blocked  uuid[];
  v_spar_notes     uuid[];
  v_spar_thanks    uuid[];
  v_spar_reviews   uuid[];
  v_fav_owner      uuid[];
  v_fav_target     uuid[];
begin
  if p_source_id = p_target_id then
    raise exception 'Source and target fighters must be different' using errcode = 'P0001';
  end if;
  if p_source_snapshot ->> 'id' is distinct from p_source_id::text
     or p_target_snapshot ->> 'id' is distinct from p_target_id::text then
    raise exception 'merge_fighters: a snapshot is not the profile it names' using errcode = 'P0004';
  end if;

  perform 1 from public.global_persons
   where id in (p_source_id, p_target_id)
   order by id for update;

  select * into v_source from public.global_persons where id = p_source_id;
  if not found then
    raise exception 'source fighter % not found', p_source_id using errcode = 'P0002';
  end if;
  select * into v_target from public.global_persons where id = p_target_id;
  if not found then
    raise exception 'target fighter % not found', p_target_id using errcode = 'P0002';
  end if;
  if v_source.merged_into_id is not null then
    raise exception 'Source fighter is already merged into another profile' using errcode = 'P0001';
  end if;
  if v_target.merged_into_id is not null or v_target.deleted_at is not null then
    raise exception 'Target fighter cannot be a merged/deleted profile' using errcode = 'P0001';
  end if;

  with moved as (
    update public.directory_follows f
       set followed_global_person_id = p_target_id
     where f.followed_global_person_id = p_source_id
       and not exists (
         select 1 from public.directory_follows t
          where t.followed_global_person_id = p_target_id
            and t.follower_user_id = f.follower_user_id)
    returning f.follower_user_id
  )
  select coalesce(array_agg(follower_user_id order by follower_user_id), '{}') into v_followers
    from moved;

  -- Registrations follow persons.global_person_id: moving the people moves them.
  with moved as (
    update public.persons
       set global_person_id = p_target_id
     where global_person_id = p_source_id
    returning id
  )
  select coalesce(array_agg(id order by id), '{}') into v_person_ids from moved;

  with moved as (
    update public.workshop_instructors w
       set global_person_id = p_target_id
     where w.global_person_id = p_source_id
       and not exists (
         select 1 from public.workshop_instructors t
          where t.workshop_id = w.workshop_id
            and t.global_person_id = p_target_id)
    returning w.id
  )
  select coalesce(array_agg(id order by id), '{}') into v_instructor_ids from moved;

  -- FightBook (0263): requests both ways, except one between the two profiles (no self-spar) and
  -- a waiting one that would double the survivor's waiting request to or from the same fighter.
  with moved as (
    update public.spar_requests r
       set asker_global_person_id = p_target_id
     where r.asker_global_person_id = p_source_id
       and r.receiver_global_person_id <> p_target_id
       and not (r.status = 'pending' and exists (
         select 1 from public.spar_requests t
          where t.asker_global_person_id = p_target_id
            and t.receiver_global_person_id = r.receiver_global_person_id
            and t.status = 'pending'))
    returning r.id
  )
  select coalesce(array_agg(id order by id), '{}') into v_spar_asker from moved;

  with moved as (
    update public.spar_requests r
       set receiver_global_person_id = p_target_id
     where r.receiver_global_person_id = p_source_id
       and r.asker_global_person_id <> p_target_id
       and not (r.status = 'pending' and exists (
         select 1 from public.spar_requests t
          where t.receiver_global_person_id = p_target_id
            and t.asker_global_person_id = r.asker_global_person_id
            and t.status = 'pending'))
    returning r.id
  )
  select coalesce(array_agg(id order by id), '{}') into v_spar_receiver from moved;

  -- Blocks both ways, so a merge never drops one; the same two exceptions.
  with moved as (
    update public.fightbook_blocks b
       set blocker_global_person_id = p_target_id
     where b.blocker_global_person_id = p_source_id
       and b.blocked_global_person_id <> p_target_id
       and not exists (
         select 1 from public.fightbook_blocks t
          where t.blocker_global_person_id = p_target_id
            and t.blocked_global_person_id = b.blocked_global_person_id)
    returning b.id
  )
  select coalesce(array_agg(id order by id), '{}') into v_block_blocker from moved;

  with moved as (
    update public.fightbook_blocks b
       set blocked_global_person_id = p_target_id
     where b.blocked_global_person_id = p_source_id
       and b.blocker_global_person_id <> p_target_id
       and not exists (
         select 1 from public.fightbook_blocks t
          where t.blocked_global_person_id = p_target_id
            and t.blocker_global_person_id = b.blocker_global_person_id)
    returning b.id
  )
  select coalesce(array_agg(id order by id), '{}') into v_block_blocked from moved;

  -- A block now held by or against the survivor ends what waits between the pair, as
  -- fightbook_block does (0264): the blocked side's request a no, the blocker's own withdrawn.
  update public.spar_requests r
     set status = 'not_this_time'
   where r.status = 'pending'
     and p_target_id in (r.asker_global_person_id, r.receiver_global_person_id)
     and exists (
       select 1 from public.fightbook_blocks b
        where b.blocker_global_person_id = r.receiver_global_person_id
          and b.blocked_global_person_id = r.asker_global_person_id);
  update public.spar_requests r
     set status = 'withdrawn'
   where r.status = 'pending'
     and p_target_id in (r.asker_global_person_id, r.receiver_global_person_id)
     and exists (
       select 1 from public.fightbook_blocks b
        where b.blocker_global_person_id = r.asker_global_person_id
          and b.blocked_global_person_id = r.receiver_global_person_id);

  with moved as (
    update public.spar_private_notes n
       set author_global_person_id = p_target_id
     where n.author_global_person_id = p_source_id
       and not exists (
         select 1 from public.spar_private_notes t
          where t.spar_request_id = n.spar_request_id
            and t.author_global_person_id = p_target_id)
    returning n.id
  )
  select coalesce(array_agg(id order by id), '{}') into v_spar_notes from moved;

  -- After the spar (0267): a thank-you and an anonymous review move with their fighter, author
  -- or subject, except one written on a spar between the two profiles: that request stays, and
  -- so does what was written on it (moved, its writer would review themselves).
  with moved as (
    update public.spar_thanks t
       set author_global_person_id  = case when t.author_global_person_id = p_source_id
                                           then p_target_id else t.author_global_person_id end,
           subject_global_person_id = case when t.subject_global_person_id = p_source_id
                                           then p_target_id else t.subject_global_person_id end
     where p_source_id in (t.author_global_person_id, t.subject_global_person_id)
       and p_target_id not in (t.author_global_person_id, t.subject_global_person_id)
    returning t.id
  )
  select coalesce(array_agg(id order by id), '{}') into v_spar_thanks from moved;

  with moved as (
    update public.spar_anonymous_reviews a
       set author_global_person_id  = case when a.author_global_person_id = p_source_id
                                           then p_target_id else a.author_global_person_id end,
           subject_global_person_id = case when a.subject_global_person_id = p_source_id
                                           then p_target_id else a.subject_global_person_id end
     where p_source_id in (a.author_global_person_id, a.subject_global_person_id)
       and p_target_id not in (a.author_global_person_id, a.subject_global_person_id)
    returning a.id
  )
  select coalesce(array_agg(id order by id), '{}') into v_spar_reviews from moved;

  -- Favourites both ways, except one between the two profiles (it would favourite itself) and
  -- one that would double a favourite the survivor already holds: those stay on the merged one.
  with moved as (
    update public.fightbook_favourites f
       set owner_global_person_id = p_target_id
     where f.owner_global_person_id = p_source_id
       and f.favourite_global_person_id <> p_target_id
       and not exists (
         select 1 from public.fightbook_favourites t
          where t.owner_global_person_id = p_target_id
            and t.favourite_global_person_id = f.favourite_global_person_id)
    returning f.id
  )
  select coalesce(array_agg(id order by id), '{}') into v_fav_owner from moved;

  with moved as (
    update public.fightbook_favourites f
       set favourite_global_person_id = p_target_id
     where f.favourite_global_person_id = p_source_id
       and f.owner_global_person_id <> p_target_id
       and not exists (
         select 1 from public.fightbook_favourites t
          where t.favourite_global_person_id = p_target_id
            and t.owner_global_person_id = f.owner_global_person_id)
    returning f.id
  )
  select coalesce(array_agg(id order by id), '{}') into v_fav_target from moved;

  if v_source.claimed_by_user_id is not null and v_target.claimed_by_user_id is null then
    v_claim := v_source.claimed_by_user_id;
  end if;

  -- The source first: it releases the account link before the target takes it.
  update public.global_persons
     set merged_into_id     = p_target_id,
         merged_at          = now(),
         merge_reverted_at  = null,
         deleted_at         = now(),
         updated_at         = now(),
         claimed_by_user_id = case when v_claim is null then claimed_by_user_id end
   where id = p_source_id;

  update public.global_persons
     set photo_url       = case when coalesce(v_target.photo_url, '') = ''
                                 and coalesce(v_source.photo_url, '') <> ''
                                then v_source.photo_url else photo_url end,
         hema_ratings_id = case when coalesce(v_target.hema_ratings_id, '') = ''
                                 and coalesce(v_source.hema_ratings_id, '') <> ''
                                then v_source.hema_ratings_id else hema_ratings_id end,
         bio             = case when coalesce(v_target.bio, '') = ''
                                 and coalesce(v_source.bio, '') <> ''
                                then v_source.bio else bio end,
         country_code    = case when coalesce(v_target.country_code, '') = ''
                                 and coalesce(v_source.country_code, '') <> ''
                                then v_source.country_code else country_code end,
         gender_category = case when coalesce(v_target.gender_category, '') = ''
                                 and coalesce(v_source.gender_category, '') <> ''
                                then v_source.gender_category else gender_category end,
         hide_workshops_publicly = v_target.hide_workshops_publicly
                                   or v_source.hide_workshops_publicly,
         allow_being_followed    = v_target.allow_being_followed
                                   and v_source.allow_being_followed,
         fightbook_enabled       = v_target.fightbook_enabled
                                   and v_source.fightbook_enabled,
         fightbook_show_stars    = v_target.fightbook_show_stars
                                   and v_source.fightbook_show_stars,
         claimed_by_user_id      = coalesce(v_claim, claimed_by_user_id),
         updated_at              = now()
   where id = p_target_id;

  -- The daily limit (0271): the survivor keeps the stricter one, as the switches above. The
  -- merged profile's own row stays where nothing reads it; nothing moved, so no record key.
  insert into public.fightbook_daily_limits as d (global_person_id, daily_limit)
  select p_target_id, l.daily_limit
    from public.fightbook_daily_limits l
   where l.global_person_id = p_source_id
  on conflict (global_person_id) do update
     set daily_limit = least(d.daily_limit, excluded.daily_limit),
         updated_at  = now();

  v_moved := jsonb_build_object(
    'personIds', to_jsonb(v_person_ids),
    'workshopInstructorIds', to_jsonb(v_instructor_ids),
    'directoryFollowerUserIds', to_jsonb(v_followers),
    'sparRequestAskerIds', to_jsonb(v_spar_asker),
    'sparRequestReceiverIds', to_jsonb(v_spar_receiver),
    'blockBlockerIds', to_jsonb(v_block_blocker),
    'blockBlockedIds', to_jsonb(v_block_blocked),
    'sparNoteIds', to_jsonb(v_spar_notes),
    'sparThanksIds', to_jsonb(v_spar_thanks),
    'sparAnonymousReviewIds', to_jsonb(v_spar_reviews),
    'favouriteOwnerIds', to_jsonb(v_fav_owner),
    'favouriteTargetIds', to_jsonb(v_fav_target)
  );
  if v_claim is not null then
    v_moved := v_moved || jsonb_build_object('claimUserId', v_claim);
  end if;

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, payload_json)
  values (
    p_actor_user_id,
    'fighter.merge',
    'fighter',
    p_source_id::text,
    jsonb_build_object(
      'source', p_source_snapshot,
      'target', p_target_snapshot,
      'moved', v_moved,
      'reason', p_reason
    )
  );

  return jsonb_build_object(
    'persons', cardinality(v_person_ids),
    'workshopInstructors', cardinality(v_instructor_ids)
  );
end;
$$;

revoke all on function public.merge_fighters(uuid, uuid, uuid, text, jsonb, jsonb) from public;

-- Named explicitly: the image grants EXECUTE to these two by name (0184).
revoke execute on function public.merge_fighters(uuid, uuid, uuid, text, jsonb, jsonb)
  from anon, authenticated;

grant execute on function public.merge_fighters(uuid, uuid, uuid, text, jsonb, jsonb) to service_role;

notify pgrst, 'reload schema';
