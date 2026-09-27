-- 0212: a fighter merge, and its revert, is ONE database call (operator ruling 133).
--
-- THE DEFECT. The API merged two profiles in about eight writes, each its own PostgREST request:
-- the directory follows in chunks of 200 (the ids travel in the URL), the event people, the
-- workshop instructors, the surviving profile, the merged-away profile, the account link and,
-- last, the merge record. A failure after the first write left half a merge and NO record of it,
-- and the record is the only thing a revert can read. Two profiles teaching the same Workshop
-- made that happen on every try: the instructors write broke the one-line-per-profile key after
-- the follows and the people had already moved. The revert had the same shape.
--
-- WHAT CHANGES. `merge_fighters` and `revert_fighter_merge` do the whole job in one function body,
-- which is one transaction: every step lands, or none does. The API reads the two profiles for
-- the record (below) and calls the function; it writes nothing else.
--
-- THE RULES KEPT (the same as the API's, moved here):
--   - 116: the follows of the merged-away profile move to the survivor. An account that follows
--     both keeps its survivor follow; its other follow stays on the merged profile (moving it would
--     break the one-follow-per-pair key). The record lists the accounts whose follow moved; the
--     revert moves exactly those back.
--   - 161: an instructor line of the merged-away profile on a Workshop the survivor already
--     teaches stays on the merged profile, the same way (UNIQUE(workshop_id, global_person_id)).
--   - 157: the survivor keeps the stricter answer per privacy choice. Its blank photo, HEMA
--     Ratings id, bio, country and gender category take the merged-away profile's values. A
--     revert touches none of the survivor's fields.
--   - 159: the account link moves to the survivor when the survivor has no owner. The old link is
--     released before the new one is taken, in two statements in that order: 0063's partial
--     unique index on claimed_by_user_id is not deferrable, so the account may never sit on both
--     rows at once. A revert moves it back only if the survivor still holds it.
--   - 125: the refusals, word for word (the API answers them 400): an already-merged source, a
--     merged or deleted target; a revert older than 30 days (720 hours: the API's millisecond
--     window, not calendar days), of a merge already reverted, while the survivor is merged away
--     since, or when a later merge of the same profile replaced it.
--   - A revert moves back only the rows still on the survivor (ruling 159's "only if it still
--     held it", applied to people and instructors too): a row relinked since stays where it is.
--     And, as 116 and 161 do the other way, a follow or an instructor line whose account or
--     Workshop already has one on the restored profile stays on the survivor: moving it would
--     break the same unique key and fail every revert of this merge.
--
-- THE LOCK. Both profiles are locked FOR UPDATE, in id order, before anything is read or moved.
-- FOR UPDATE, not FOR NO KEY UPDATE: it conflicts with the FOR KEY SHARE lock that inserting a
-- follow, a person or an instructor pointing at either profile takes on it, so such a write
-- WAITS until the merge commits and cannot slip between its reads and its writes (the old
-- "follow tapped since the read" race). It is not refused: a follow of the merged-away profile
-- that was checked live before the lock lands on it after the merge (milliseconds; the revert's
-- guard above keeps such a follow from blocking a revert). Id order, so two merges of
-- overlapping profiles cannot deadlock. Two reverts of one merge queue on the same locks; the
-- second finds it reverted.
--
-- THE RECORD. `audit_log` rows are written by the API's insertAuditLog, which masks personal
-- values (email, date of birth) on the way in. The merge record must be written in this
-- transaction, so the function writes it — with the profile snapshots the API read and masked
-- with that same masker, passed in as p_source_snapshot / p_target_snapshot. One masker, not a
-- second one in SQL to drift. The snapshots are the record's display (names in the merge
-- history); every decision above reads the LOCKED rows. Record shape, read by the merge history
-- screen and the entity labels:
--   { source, target,
--     moved: { personIds, workshopInstructorIds, directoryFollowerUserIds, claimUserId? },
--     reason }
-- The revert record: { reverted_audit_log_id, source_id, target_id }.
--
-- ERRORS. A refusal is RAISE with SQLSTATE P0001 and a not-found P0002, carrying the words the
-- API answers (400 and 404). A snapshot whose id is not the profile's, or a merge record that
-- names no source or target, is P0004: a bug, a 5xx.
-- Anything else (a constraint the rules above did not foresee) rolls the whole call back.
--
-- SECURITY INVOKER, search_path pinned, service role only: the 0190 / 0207 pattern. The API calls
-- these through the service-role client (BYPASSRLS); anon and authenticated are revoked by name,
-- because the image grants them EXECUTE by name (0184).

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
         claimed_by_user_id      = coalesce(v_claim, claimed_by_user_id),
         updated_at              = now()
   where id = p_target_id;

  v_moved := jsonb_build_object(
    'personIds', to_jsonb(v_person_ids),
    'workshopInstructorIds', to_jsonb(v_instructor_ids),
    'directoryFollowerUserIds', to_jsonb(v_followers)
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

create or replace function public.revert_fighter_merge(
  p_audit_log_id  uuid,
  p_actor_user_id uuid
)
returns void
language plpgsql
volatile
set search_path = public, pg_catalog
as $$
declare
  v_audit     public.audit_log;
  v_moved     jsonb;
  v_source_id uuid;
  v_target_id uuid;
  v_source    public.global_persons;
  v_target    public.global_persons;
  v_claim     uuid;
begin
  select * into v_audit from public.audit_log where id = p_audit_log_id;
  if not found then
    raise exception 'Merge audit log % not found', p_audit_log_id using errcode = 'P0002';
  end if;
  if v_audit.action <> 'fighter.merge' then
    raise exception 'Audit log entry is not a fighter merge' using errcode = 'P0001';
  end if;
  if v_audit.created_at < now() - interval '720 hours' then
    raise exception 'Fighter merge can only be reverted within 30 days' using errcode = 'P0001';
  end if;

  v_source_id := (v_audit.payload_json -> 'source' ->> 'id')::uuid;
  v_target_id := (v_audit.payload_json -> 'target' ->> 'id')::uuid;
  v_moved := coalesce(v_audit.payload_json -> 'moved', '{}'::jsonb);
  if v_source_id is null or v_target_id is null then
    raise exception 'revert_fighter_merge: merge record % names no source or target', p_audit_log_id
      using errcode = 'P0004';
  end if;

  perform 1 from public.global_persons
   where id in (v_source_id, v_target_id)
   order by id for update;

  select * into v_source from public.global_persons where id = v_source_id;
  if not found then
    raise exception 'source fighter % not found', v_source_id using errcode = 'P0002';
  end if;
  if v_source.merged_into_id is distinct from v_target_id then
    raise exception 'This fighter merge was already reverted' using errcode = 'P0001';
  end if;
  select * into v_target from public.global_persons where id = v_target_id;
  if not found then
    raise exception 'target fighter % not found', v_target_id using errcode = 'P0002';
  end if;
  if v_target.merged_into_id is not null then
    raise exception 'The surviving fighter was merged into another profile since: revert that merge first'
      using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.audit_log
     where action = 'fighter.merge'
       and entity_type = 'fighter'
       and entity_id = v_source_id::text
       and created_at > v_audit.created_at
  ) then
    raise exception 'A later merge of this fighter replaced this one: revert the later merge first'
      using errcode = 'P0001';
  end if;

  -- Records older than ruling 116 carry no directoryFollowerUserIds: nothing of theirs moved.
  update public.directory_follows f
     set followed_global_person_id = v_source_id
   where f.followed_global_person_id = v_target_id
     and f.follower_user_id in (
       select value::uuid
         from jsonb_array_elements_text(coalesce(v_moved -> 'directoryFollowerUserIds', '[]')))
     and not exists (
       select 1 from public.directory_follows s
        where s.followed_global_person_id = v_source_id
          and s.follower_user_id = f.follower_user_id);

  -- Older records may carry registrationIds: registrations follow persons since 0083, ignored.
  update public.persons
     set global_person_id = v_source_id
   where global_person_id = v_target_id
     and id in (
       select value::uuid
         from jsonb_array_elements_text(coalesce(v_moved -> 'personIds', '[]')));

  update public.workshop_instructors w
     set global_person_id = v_source_id
   where w.global_person_id = v_target_id
     and w.id in (
       select value::uuid
         from jsonb_array_elements_text(coalesce(v_moved -> 'workshopInstructorIds', '[]')))
     and not exists (
       select 1 from public.workshop_instructors s
        where s.workshop_id = w.workshop_id
          and s.global_person_id = v_source_id);

  -- The account link goes back only if the survivor still holds it (ruling 159): released on the
  -- survivor first, then taken on the source.
  v_claim := (v_moved ->> 'claimUserId')::uuid;
  if v_claim is not null and v_target.claimed_by_user_id is not distinct from v_claim then
    update public.global_persons set claimed_by_user_id = null where id = v_target_id;
  else
    v_claim := null;
  end if;

  update public.global_persons
     set merged_into_id     = null,
         merged_at          = null,
         deleted_at         = null,
         merge_reverted_at  = now(),
         updated_at         = now(),
         claimed_by_user_id = coalesce(v_claim, claimed_by_user_id)
   where id = v_source_id;

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, payload_json)
  values (
    p_actor_user_id,
    'fighter.merge_revert',
    'fighter',
    v_source_id::text,
    jsonb_build_object(
      'reverted_audit_log_id', p_audit_log_id,
      'source_id', v_source_id,
      'target_id', v_target_id
    )
  );
end;
$$;

revoke all on function public.revert_fighter_merge(uuid, uuid) from public;

-- Named explicitly: the image grants EXECUTE to these two by name (0184).
revoke execute on function public.revert_fighter_merge(uuid, uuid) from anon, authenticated;

grant execute on function public.revert_fighter_merge(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
