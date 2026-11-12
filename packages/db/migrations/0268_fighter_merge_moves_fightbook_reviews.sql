-- 0268: a fighter merge, and its revert, carry what comes after the spar (0267).
--
-- THE DEFECT IT PREVENTS. `merge_fighters` (0265) moves FightBook's spars, blocks and notes by
-- hand. 0267 added three more tables that hold the profile id: without this, a merge would leave
-- the merged-away profile's thank-yous, reviews and favourites where nothing reads them, and the
-- survivor's star line would lose the stars given to the other profile.
--
-- WHAT CHANGES. Both functions are redefined here, 0265's bodies unchanged plus:
--   - spar_thanks and spar_anonymous_reviews move to the survivor, author or subject, except a
--     row on a spar between the two profiles: that spar stays (0265), and so does every
--     thank-you and review on it, on the same two profiles. A review lives only on a spar that
--     was done, so a waiting request 0265 keeps never carries one.
--   - fightbook_favourites, both columns, except a favourite between the two profiles (the
--     survivor favourited the merged one, or the other way round: moved, it would favourite
--     itself) and one that would double a favourite the survivor already holds (as 0265 keeps a
--     doubled block). Both stay on the merged profile, where nothing reads them; a revert
--     restores the profile with them.
--   - The survivor keeps the stricter star switch: fightbook_show_stars, off wins, as
--     fightbook_enabled (0265).
--   - The record lists every moved id (sparThanksIds, sparAnonymousReviewIds, favouriteOwnerIds,
--     favouriteTargetIds), so the audit trail shows what moved.
--   - The revert moves a thank-you or a review back with its SPAR, not by its recorded id: every
--     row on a spar the revert moves back (0265's sparRequestAskerIds, sparRequestReceiverIds),
--     on the side that holds the survivor. A review written after the merge on such a spar goes
--     back too; else the merged profile's partner's stars would stay on the survivor's line, and
--     the restored profile could be reviewed twice for one spar.
--   - The revert moves exactly the recorded favourites back while they still sit on the
--     survivor, never onto a duplicate. The survivor's star switch is not touched by a revert.
--
-- Everything else, the lock, the refusals, the record, the rights, is 0265's, word for word.
-- SECURITY INVOKER, search_path pinned, service role only.

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

  -- FightBook (0263): exactly the recorded rows still on the survivor, never onto a waiting
  -- request, a block or a note the restored profile already has. A request the merge ended stays
  -- ended. Records older than 0265 carry none of these keys: nothing of theirs moved.
  update public.spar_requests r
     set asker_global_person_id = v_source_id
   where r.asker_global_person_id = v_target_id
     and r.id in (select value::uuid
                    from jsonb_array_elements_text(coalesce(v_moved -> 'sparRequestAskerIds', '[]')))
     and not (r.status = 'pending' and exists (
       select 1 from public.spar_requests s
        where s.asker_global_person_id = v_source_id
          and s.receiver_global_person_id = r.receiver_global_person_id
          and s.status = 'pending'));

  update public.spar_requests r
     set receiver_global_person_id = v_source_id
   where r.receiver_global_person_id = v_target_id
     and r.id in (select value::uuid
                    from jsonb_array_elements_text(coalesce(v_moved -> 'sparRequestReceiverIds', '[]')))
     and not (r.status = 'pending' and exists (
       select 1 from public.spar_requests s
        where s.receiver_global_person_id = v_source_id
          and s.asker_global_person_id = r.asker_global_person_id
          and s.status = 'pending'));

  update public.fightbook_blocks b
     set blocker_global_person_id = v_source_id
   where b.blocker_global_person_id = v_target_id
     and b.id in (select value::uuid
                    from jsonb_array_elements_text(coalesce(v_moved -> 'blockBlockerIds', '[]')))
     and not exists (
       select 1 from public.fightbook_blocks s
        where s.blocker_global_person_id = v_source_id
          and s.blocked_global_person_id = b.blocked_global_person_id);

  update public.fightbook_blocks b
     set blocked_global_person_id = v_source_id
   where b.blocked_global_person_id = v_target_id
     and b.id in (select value::uuid
                    from jsonb_array_elements_text(coalesce(v_moved -> 'blockBlockedIds', '[]')))
     and not exists (
       select 1 from public.fightbook_blocks s
        where s.blocked_global_person_id = v_source_id
          and s.blocker_global_person_id = b.blocker_global_person_id);

  update public.spar_private_notes n
     set author_global_person_id = v_source_id
   where n.author_global_person_id = v_target_id
     and n.id in (select value::uuid
                    from jsonb_array_elements_text(coalesce(v_moved -> 'sparNoteIds', '[]')))
     and not exists (
       select 1 from public.spar_private_notes s
        where s.spar_request_id = n.spar_request_id
          and s.author_global_person_id = v_source_id);

  -- After the spar (0267). A thank-you or a review follows its spar: every row on a spar this
  -- revert moved back goes back with it, on the side that holds the survivor, the ones written
  -- after the merge included (written about or by the survivor on what was the merged profile's
  -- spar). A spar has one row per writer per table, and a merged profile writes nothing, so no
  -- row can double. Records older than 0265 carry no spar ids: nothing of theirs moved.
  update public.spar_thanks t
     set author_global_person_id  = case when t.author_global_person_id = v_target_id
                                         then v_source_id else t.author_global_person_id end,
         subject_global_person_id = case when t.subject_global_person_id = v_target_id
                                         then v_source_id else t.subject_global_person_id end
   where v_target_id in (t.author_global_person_id, t.subject_global_person_id)
     and t.spar_request_id in (select value::uuid
                                from jsonb_array_elements_text(coalesce(v_moved -> 'sparRequestAskerIds', '[]'))
                              union all
                              select value::uuid
                                from jsonb_array_elements_text(coalesce(v_moved -> 'sparRequestReceiverIds', '[]')));

  update public.spar_anonymous_reviews a
     set author_global_person_id  = case when a.author_global_person_id = v_target_id
                                         then v_source_id else a.author_global_person_id end,
         subject_global_person_id = case when a.subject_global_person_id = v_target_id
                                         then v_source_id else a.subject_global_person_id end
   where v_target_id in (a.author_global_person_id, a.subject_global_person_id)
     and a.spar_request_id in (select value::uuid
                                from jsonb_array_elements_text(coalesce(v_moved -> 'sparRequestAskerIds', '[]'))
                              union all
                              select value::uuid
                                from jsonb_array_elements_text(coalesce(v_moved -> 'sparRequestReceiverIds', '[]')));

  -- Favourites: exactly the recorded rows still on the survivor, never onto a favourite the
  -- restored profile already has. That one can exist: a favourite added on the merged profile
  -- (by its owner, or by someone favouriting it) whose checks passed just before the merge and
  -- whose insert landed just after it, then stays on the survivor.
  update public.fightbook_favourites f
     set owner_global_person_id = v_source_id
   where f.owner_global_person_id = v_target_id
     and f.id in (select value::uuid
                    from jsonb_array_elements_text(coalesce(v_moved -> 'favouriteOwnerIds', '[]')))
     and not exists (
       select 1 from public.fightbook_favourites s
        where s.owner_global_person_id = v_source_id
          and s.favourite_global_person_id = f.favourite_global_person_id);

  update public.fightbook_favourites f
     set favourite_global_person_id = v_source_id
   where f.favourite_global_person_id = v_target_id
     and f.id in (select value::uuid
                    from jsonb_array_elements_text(coalesce(v_moved -> 'favouriteTargetIds', '[]')))
     and not exists (
       select 1 from public.fightbook_favourites s
        where s.favourite_global_person_id = v_source_id
          and s.owner_global_person_id = f.owner_global_person_id);

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
