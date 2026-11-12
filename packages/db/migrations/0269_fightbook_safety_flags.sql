-- 0269: FightBook, slice 4 — safety flags (rulings 691-698).
--
-- After a spar, a fighter can flag a safety problem about their partner: one of four reasons and
-- a required text (693), from 00:00 of the spar day (691, judged by the API on the request's
-- immutable `spar_day` / `zone`), on an agreed, done or cancelled spar (697). The Event's club
-- admins read it, minus the flagged fighter (692); the platform super admins read and handle every
-- flag; a free-date spar, or a club with no admin left to tell, alerts the super admins. The
-- reporter sees "sent" only (694). The alert passes the main notification switch, by email (698).
--
-- 1. `spar_flags`: what the reporter wrote, and a snapshot of the spar it is about (kind, Event,
--    the Event's club at write time, day, place, weapons). The flag outlives the spar: an erased
--    reporter's spars are deleted and the flag stays (`spar_request_id` and the reporter go null).
--    A flag goes when its subject's profile goes, and after 2 years (`spar_flag_days`, 730).
--
-- 2. `spar_flag_admin`: what only admins may know, one row per flag, written with it in one
--    transaction: the account that held the flagged profile when the flag was written
--    (`subject_user_id`, no FK, the actor-UUID shape) and the "handled" mark. Two tables because the
--    data download carries whole rows: on `spar_flags`, `handled_at` would reach the reporter (694:
--    "sent" only) and `subject_user_id` would hand the reporter another person's account id. To the
--    subject the admin row would reveal the flag (Art. 15(4)), so it reaches nobody's download.
--
-- 3. No flag moves on a fighter merge. A flag keeps the profile ids it was written with, and every
--    rule follows the merge family instead (`fightbook_profile_family`: the profiles joined by
--    `merged_into_id`, both ways). So the merge record, readable by every platform tier, never
--    names a flag, and a revert (which clears `merged_into_id`) splits the family again.
--
-- 4. `fightbook_flag_shown` is the ONE owner of "who must never read this flag" (anti-goal 4,
--    ruling 656): not the account that held the flagged profile when the flag was written, not any
--    account that holds a profile of the flagged fighter's family (in any state), and on the club
--    side not anyone while no account holds that family (696: the flag shows to super admins only
--    until the profile is linked again). The lists, the handled mark and the alert's recipients
--    all go through it; no other code decides it.
--
-- 5. The functions, each one database call:
--    - fightbook_flag: write a flag in the 0267 `fightbook_review` lock order (both profiles KEY
--      SHARE in id order, then the request FOR UPDATE, both profile columns re-checked). Every
--      refusal is `not_open` (P0001). A second flag on the spar by the reporter's family answers
--      null (two taps: the second asked for what happened).
--    - fightbook_flags_page: one page of a club's or the platform's list, the shown filter inside
--      the query, so a page is never cut short after it was read.
--    - fightbook_flag_mark: set or clear "handled"; true means "in that scope and shown".
--    - fightbook_flag_recipients: who gets the alert (never the reporter's own accounts).
--    - fightbook_flags_erase: account erasure, reaching no further than the erased account.
--
-- Deny-all: RLS on, no policy; the API reads and writes these as the service role (0247). Every
-- CHECK is a CASE with ELSE false: a CHECK written as an OR of comparisons reads NULL and passes.
-- SECURITY INVOKER, search_path pinned, service role only (the 0264 shape). The four read
-- functions are `language sql`: a plpgsql `returns table` whose column names match the table's
-- raises "column reference ... is ambiguous".

CREATE TABLE IF NOT EXISTS public.spar_flags (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spar_request_id            UUID REFERENCES public.spar_requests(id) ON DELETE SET NULL,
  reporter_global_person_id  UUID REFERENCES public.global_persons(id) ON DELETE SET NULL,
  subject_global_person_id   UUID NOT NULL REFERENCES public.global_persons(id) ON DELETE CASCADE,
  kind                       TEXT NOT NULL,
  event_id                   UUID REFERENCES public.events(id) ON DELETE SET NULL,
  organization_id            UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  spar_day                   DATE NOT NULL,
  place                      TEXT,
  weapons                    TEXT[] NOT NULL,
  reason                     TEXT NOT NULL,
  body                       TEXT NOT NULL,
  created_at                 TIMESTAMPTZ NOT NULL,
  CONSTRAINT spar_flags_two_fighters CHECK (
    CASE WHEN reporter_global_person_id IS NULL THEN true
         WHEN reporter_global_person_id <> subject_global_person_id THEN true
         ELSE false END),
  CONSTRAINT spar_flags_reason CHECK (
    CASE WHEN reason IN ('too_hard', 'equipment', 'disrespect', 'other') THEN true ELSE false END),
  CONSTRAINT spar_flags_body CHECK (
    CASE WHEN char_length(body) BETWEEN 1 AND 1000 THEN true ELSE false END)
);

COMMENT ON TABLE public.spar_flags IS
  'FightBook: a safety flag on a spar partner, with a snapshot of the spar. Its subject never reads it. Deny-all; API only.';

CREATE UNIQUE INDEX IF NOT EXISTS spar_flags_reporter_uk
  ON public.spar_flags (spar_request_id, reporter_global_person_id);
CREATE INDEX IF NOT EXISTS spar_flags_org_idx
  ON public.spar_flags (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS spar_flags_created_idx
  ON public.spar_flags (created_at DESC);
CREATE INDEX IF NOT EXISTS spar_flags_reporter_idx
  ON public.spar_flags (reporter_global_person_id);
CREATE INDEX IF NOT EXISTS spar_flags_subject_idx
  ON public.spar_flags (subject_global_person_id);
CREATE INDEX IF NOT EXISTS spar_flags_event_idx
  ON public.spar_flags (event_id);

ALTER TABLE public.spar_flags ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.spar_flag_admin (
  flag_id          UUID PRIMARY KEY REFERENCES public.spar_flags(id) ON DELETE CASCADE,
  subject_user_id  UUID,
  handled_at       TIMESTAMPTZ
);

COMMENT ON TABLE public.spar_flag_admin IS
  'FightBook: what only admins know about a safety flag (the flagged account at write time, the handled mark). In no data download. Deny-all; API only.';

ALTER TABLE public.spar_flag_admin ENABLE ROW LEVEL SECURITY;

-- A flag is deleted 2 years after it was written (the 0161 column shape; 0 keeps it forever).
ALTER TABLE public.data_retention_settings
  ADD COLUMN IF NOT EXISTS spar_flag_days int NOT NULL DEFAULT 730 CHECK (spar_flag_days >= 0);

-- The ids plus every profile joined to them by `merged_into_id`, both ways, transitively. UNION,
-- never UNION ALL: the walk goes both ways, so A -> B -> A would cycle. The reverse step uses the
-- `merged_into_id` index (0012, carried over by the 0023 rename).
create or replace function public.fightbook_profile_family(p_ids uuid[])
returns uuid[]
language sql
stable
set search_path = public, pg_catalog
as $$
  with recursive fam(id) as (
    select i.id from unnest(p_ids) as i(id) where i.id is not null
    union
    select n.id
      from fam f
      cross join lateral (
        select g.merged_into_id as id
          from public.global_persons g
         where g.id = f.id and g.merged_into_id is not null
        union all
        select g.id
          from public.global_persons g
         where g.merged_into_id = f.id
      ) n
  )
  select coalesce(array_agg(fam.id), '{}'::uuid[]) from fam;
$$;

revoke all on function public.fightbook_profile_family(uuid[]) from public;
revoke execute on function public.fightbook_profile_family(uuid[]) from anon, authenticated;
grant execute on function public.fightbook_profile_family(uuid[]) to service_role;

-- The one owner of "who must never read this flag". False for an unknown flag or caller.
create or replace function public.fightbook_flag_shown(p_flag uuid, p_caller uuid, p_club boolean)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select coalesce((
    select a.subject_user_id is distinct from p_caller
       and not exists (
         select 1 from public.global_persons g
          where g.id = any(x.ids) and g.claimed_by_user_id = p_caller)
       and (not p_club or exists (
         select 1 from public.global_persons g
          where g.id = any(x.ids) and g.claimed_by_user_id is not null))
      from public.spar_flags f
      join public.spar_flag_admin a on a.flag_id = f.id
      cross join lateral (
        select public.fightbook_profile_family(array[f.subject_global_person_id]) as ids
      ) x
     where f.id = p_flag and p_caller is not null
  ), false);
$$;

revoke all on function public.fightbook_flag_shown(uuid, uuid, boolean) from public;
revoke execute on function public.fightbook_flag_shown(uuid, uuid, boolean) from anon, authenticated;
grant execute on function public.fightbook_flag_shown(uuid, uuid, boolean) to service_role;

create or replace function public.fightbook_flag(
  p_request  uuid,
  p_reporter uuid,
  p_reason   text,
  p_body     text,
  p_now      timestamptz
)
returns uuid
language plpgsql
volatile
set search_path = public, pg_catalog
as $$
declare
  v_asker    uuid;
  v_receiver uuid;
  v_subject  uuid;
  v_kind     text;
  v_event    uuid;
  v_day      date;
  v_place    text;
  v_weapons  text[];
  v_id       uuid;
begin
  select r.asker_global_person_id, r.receiver_global_person_id
    into v_asker, v_receiver
    from public.spar_requests r where r.id = p_request;
  if v_asker is null then
    raise exception 'not_open' using errcode = 'P0001';
  end if;

  perform 1 from public.global_persons
   where id in (v_asker, v_receiver)
   order by id for key share;

  -- The row again, locked, with both profile columns re-checked: a merge that ran between the
  -- plain read and the lock moved them.
  select case when r.asker_global_person_id = p_reporter then r.receiver_global_person_id
              else r.asker_global_person_id end,
         r.kind, r.event_id, r.spar_day, r.place, r.weapons
    into v_subject, v_kind, v_event, v_day, v_place, v_weapons
    from public.spar_requests r
   where r.id = p_request
     and r.asker_global_person_id = v_asker and r.receiver_global_person_id = v_receiver
     and p_reporter in (r.asker_global_person_id, r.receiver_global_person_id)
     and r.status in ('agreed', 'done', 'cancelled')
   for update;
  if v_subject is null then
    raise exception 'not_open' using errcode = 'P0001';
  end if;

  -- Both profiles live: merged, deleted or erased profiles write nothing and are flagged by
  -- nothing. FightBook may be off: an off fighter still flags (ruling 666).
  if (select count(*) from public.global_persons g
       where g.id in (v_asker, v_receiver) and g.merged_into_id is null and g.deleted_at is null
         and g.account_deleted_at is null) <> 2 then
    raise exception 'not_open' using errcode = 'P0001';
  end if;

  -- One flag per spar by the reporter's family: a profile merged into the reporter may have
  -- flagged this spar before the merge moved it.
  if exists (
    select 1 from public.spar_flags f
     where f.spar_request_id = p_request
       and f.reporter_global_person_id = any(public.fightbook_profile_family(array[p_reporter]))
  ) then
    return null;
  end if;

  begin
    insert into public.spar_flags
      (spar_request_id, reporter_global_person_id, subject_global_person_id, kind, event_id,
       organization_id, spar_day, place, weapons, reason, body, created_at)
    values
      (p_request, p_reporter, v_subject, v_kind, v_event,
       (select e.organization_id from public.events e where e.id = v_event),
       v_day, v_place, v_weapons, p_reason, btrim(p_body), p_now)
    returning id into v_id;

    insert into public.spar_flag_admin (flag_id, subject_user_id)
    values (v_id, (select g.claimed_by_user_id from public.global_persons g where g.id = v_subject));
  exception when unique_violation then
    return null;
  end;

  return v_id;
end;
$$;

revoke all on function public.fightbook_flag(uuid, uuid, text, text, timestamptz) from public;
revoke execute on function public.fightbook_flag(uuid, uuid, text, text, timestamptz) from anon, authenticated;
grant execute on function public.fightbook_flag(uuid, uuid, text, text, timestamptz) to service_role;

-- One page of the club's list (`p_org`) or the platform's (`p_org` null), newest first. Never
-- `subject_user_id`: the API never holds it.
create or replace function public.fightbook_flags_page(
  p_caller uuid,
  p_org    uuid,
  p_offset int,
  p_limit  int
)
returns table (
  id                        uuid,
  created_at                timestamptz,
  reason                    text,
  body                      text,
  reporter_global_person_id uuid,
  subject_global_person_id  uuid,
  kind                      text,
  event_id                  uuid,
  organization_id           uuid,
  spar_day                  date,
  place                     text,
  weapons                   text[],
  handled_at                timestamptz
)
language sql
stable
set search_path = public, pg_catalog
as $$
  select f.id, f.created_at, f.reason, f.body, f.reporter_global_person_id,
         f.subject_global_person_id, f.kind, f.event_id, f.organization_id, f.spar_day, f.place,
         f.weapons, a.handled_at
    from public.spar_flags f
    join public.spar_flag_admin a on a.flag_id = f.id
   where (p_org is null or f.organization_id = p_org)
     and public.fightbook_flag_shown(f.id, p_caller, p_org is not null)
   order by f.created_at desc, f.id desc
  offset greatest(coalesce(p_offset, 0), 0)
   limit p_limit;
$$;

revoke all on function public.fightbook_flags_page(uuid, uuid, int, int) from public;
revoke execute on function public.fightbook_flags_page(uuid, uuid, int, int) from anon, authenticated;
grant execute on function public.fightbook_flags_page(uuid, uuid, int, int) to service_role;

-- Set or clear "handled". True means "in that scope and shown", whatever the mark was before (a
-- second tap answers the same); false writes nothing.
create or replace function public.fightbook_flag_mark(
  p_caller  uuid,
  p_org     uuid,
  p_flag    uuid,
  p_handled boolean,
  p_now     timestamptz
)
returns boolean
language plpgsql
volatile
set search_path = public, pg_catalog
as $$
begin
  update public.spar_flag_admin a
     set handled_at = case when p_handled then coalesce(a.handled_at, p_now) else null end
   where a.flag_id = p_flag
     and exists (
       select 1 from public.spar_flags f
        where f.id = a.flag_id and (p_org is null or f.organization_id = p_org))
     and public.fightbook_flag_shown(p_flag, p_caller, p_org is not null);
  return found;
end;
$$;

revoke all on function public.fightbook_flag_mark(uuid, uuid, uuid, boolean, timestamptz) from public;
revoke execute on function public.fightbook_flag_mark(uuid, uuid, uuid, boolean, timestamptz) from anon, authenticated;
grant execute on function public.fightbook_flag_mark(uuid, uuid, uuid, boolean, timestamptz) to service_role;

-- Who gets the alert: the flag's club members with one of `p_roles` it is shown to; when none
-- (or no club), the super admins it is shown to. Never an account of the reporter's family.
create or replace function public.fightbook_flag_recipients(p_flag uuid, p_roles text[])
returns table (user_id uuid, audience text, org_slug text)
language sql
stable
set search_path = public, pg_catalog
as $$
  with flag as (
    select f.id, f.organization_id, f.reporter_global_person_id
      from public.spar_flags f where f.id = p_flag
  ),
  reporter_accounts as (
    select g.claimed_by_user_id as uid
      from flag
      join public.global_persons g
        on g.id = any(public.fightbook_profile_family(array[flag.reporter_global_person_id]))
     where g.claimed_by_user_id is not null
  ),
  club as (
    select m.user_id, 'club'::text as audience, o.slug as org_slug
      from flag
      join public.organizations o on o.id = flag.organization_id
      join public.organization_members m on m.organization_id = o.id
     where m.role = any(p_roles)
       and not exists (select 1 from reporter_accounts r where r.uid = m.user_id)
       and public.fightbook_flag_shown(flag.id, m.user_id, true)
  )
  select c.user_id, c.audience, c.org_slug from club c
  union all
  select pr.user_id, 'platform'::text, null::text
    from flag
    join public.platform_roles pr on pr.role = 'super_admin'
   where not exists (select 1 from club)
     and not exists (select 1 from reporter_accounts r where r.uid = pr.user_id)
     and public.fightbook_flag_shown(flag.id, pr.user_id, false);
$$;

revoke all on function public.fightbook_flag_recipients(uuid, text[]) from public;
revoke execute on function public.fightbook_flag_recipients(uuid, text[]) from anon, authenticated;
grant execute on function public.fightbook_flag_recipients(uuid, text[]) to service_role;

-- Account erasure (`p_uid`, the profiles it holds `p_ids`), reaching no further than that account.
-- Deleted: a flag about a profile of the erased profiles' family that `p_uid` holds or no account
-- holds (in a merge of two claimed profiles, the other account's profile is not erased with this
-- one); a flag written while `p_uid` held its subject, while that subject is unheld or still held
-- by `p_uid` (not after a wrong autolink was undone and someone else holds it). Cleared: the
-- reporter, on the profiles `p_uid` holds; the flag stays, with its spar snapshot.
create or replace function public.fightbook_flags_erase(p_uid uuid, p_ids uuid[])
returns jsonb
language plpgsql
volatile
set search_path = public, pg_catalog
as $$
declare
  v_deleted int;
  v_cleared int;
begin
  delete from public.spar_flags f
   where f.subject_global_person_id in (
           select g.id from public.global_persons g
            where g.id = any(public.fightbook_profile_family(p_ids))
              and (g.claimed_by_user_id is null or g.claimed_by_user_id = p_uid))
      or exists (
           select 1
             from public.spar_flag_admin a
             join public.global_persons g on g.id = f.subject_global_person_id
            where a.flag_id = f.id and a.subject_user_id = p_uid
              and (g.claimed_by_user_id is null or g.claimed_by_user_id = p_uid));
  get diagnostics v_deleted = row_count;

  update public.spar_flags f
     set reporter_global_person_id = null
   where f.reporter_global_person_id in (
           select g.id from public.global_persons g where g.claimed_by_user_id = p_uid);
  get diagnostics v_cleared = row_count;

  return jsonb_build_object('deleted', v_deleted, 'cleared', v_cleared);
end;
$$;

revoke all on function public.fightbook_flags_erase(uuid, uuid[]) from public;
revoke execute on function public.fightbook_flags_erase(uuid, uuid[]) from anon, authenticated;
grant execute on function public.fightbook_flags_erase(uuid, uuid[]) to service_role;

NOTIFY pgrst, 'reload schema';
