-- 0273: a signed-in reader reads through the API, never through the database's web door
-- (operator rulings 821 and 822; the helper loop once called "ruling 228").
--
-- THE DEFECT. `authenticated` held SELECT on every relation of `public` (the image's default
-- privileges; 0247 took only the writes). A signed-in account's own access token, the same
-- GoTrue token the API keeps in its session cookie, opens the database's web door: PostgREST at
-- /rest/v1 and the live channel at /realtime/v1. There, seven SECURITY INVOKER helpers read
-- tables whose policies call them again (0201 named the loops), so a signed-in read errors with
-- "stack depth limit exceeded" wherever a platform role exists, as in prod. Two harms:
--   1. The live channel checks each change against RLS as each subscriber, in ONE poll shared by
--      every subscriber. Measured 2026-11-16 on the prod compose (supabase/realtime:v2.124.1, our
--      migrations, the RLS probe's seed): an anonymous viewer of a published bout gets every
--      update, two anonymous viewers both do; ONE signed-in socket on `matches`, a club admin's or
--      a stranger's, and NO viewer gets any update ("PoolingReplicationError ... stack depth limit
--      exceeded" in `is_platform_staff`), until about a minute after that socket closes. Anyone
--      can make an account, so anyone could freeze the public live scores.
--   2. Ending the loop instead would wake policies that have never answered a signed-in reader,
--      nine of them wider than the API (referee payments, the member list, broadcast recipients'
--      addresses, workshop rosters, who wrote a workshop review, others' AI history, ...).
--
-- WHAT CHANGES (ruling 821: signed-in reads go through the API only).
--   1. `authenticated` loses SELECT on every relation of `public` (tables, views, materialized,
--      foreign and partitioned tables). A table-level revoke also takes the role's column grants
--      (0205, 0259, 0260 split three tables per column "to anon, authenticated"): anon keeps its
--      columns. Sequences keep their grants, as in 0247 (PostgREST has no verb for them).
--   2. The default privileges of `postgres` and `supabase_admin`, in `public` and globally, no
--      longer give `authenticated` SELECT on a new table (0247's loop and its skip rule).
--   3. The eight policies for `authenticated` alone go: no role they serve can read their table.
--   4. A guard fails the migration if any of it is left.
-- A signed-in token at /rest/v1 now gets 42501 on any table. On the live channel, its
-- subscription answers "Error 401: Unauthorized" for itself and the poll goes on for everyone
-- else (measured, same setup). The helpers and the loop stay, out of reach of any table read. A
-- signed-in call of an INVOKER function now fails on the tables it reads, not on the loop.
--
-- WHAT DOES NOT CHANGE. Every anonymous read: the public pages, and the live channel, whose
-- browser clients are anonymous (they never hold a session). The API reads as the service role.
-- Policies `to public` stay (anon reads through them); their signed-in branches can no longer
-- fire for any web role (named, not rewritten). Organisers' live updates on draft Events (ruling
-- 110a) would need both a SELECT for `authenticated` and the loop ended: a later ruling, if ever.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table, no new function. For reads, `anon` is the only web role, bounded by RLS; a
-- signed-in reader goes through the API, bounded by its role checks. Web read grants from now on
-- go to `anon` only.

revoke select on all tables in schema public from authenticated;

do $$
declare
  r text;
begin
  foreach r in array array['postgres', 'supabase_admin'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      continue;
    end if;
    if not ((select rolsuper from pg_roles where rolname = current_user)
            or pg_has_role(current_user, r, 'MEMBER')) then
      raise notice '0273: % may not change the default privileges of %; skipped', current_user, r;
      continue;
    end if;
    execute format(
      'alter default privileges for role %I in schema public revoke select on tables from authenticated',
      r);
    execute format(
      'alter default privileges for role %I revoke select on tables from authenticated',
      r);
  end loop;
end
$$;

drop policy "authenticated_read" on hema_ratings_snapshots;
drop policy "authenticated_read" on hema_rating_history;
drop policy "Org admins read exchange edit requests" on public.exchange_edit_requests;
drop policy organizer_ai_assistant_drafts_org_read on organizer_ai_assistant_drafts;
drop policy organizer_chat_conversations_org_read on organizer_chat_conversations;
drop policy organizer_chat_messages_org_read on organizer_chat_messages;
drop policy "Org members read tournament ruleset repins" on public.tournament_ruleset_repins;
drop policy "Super admins read tournament ruleset repins" on public.tournament_ruleset_repins;

do $$
declare
  offender text;
begin
  select c.relname into offender
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and not exists (select 1 from pg_depend d
                    where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
    and has_any_column_privilege('authenticated', c.oid, 'SELECT')
  order by c.relname
  limit 1;
  if offender is not null then
    raise exception '0273: authenticated still reads %', offender;
  end if;

  select pg_get_userbyid(d.defaclrole) into offender
  from pg_default_acl d
  cross join aclexplode(d.defaclacl) as a
  where d.defaclobjtype = 'r'
    and d.defaclnamespace in (0, 'public'::regnamespace)
    and a.privilege_type = 'SELECT'
    and a.grantee = 'authenticated'::regrole
  limit 1;
  if offender is not null then
    raise exception '0273: new tables of % still give authenticated SELECT', offender
      using hint = 'Run the migrations as a superuser (supabase_admin on the Supabase image), '
        'or as a member of the role named; a role skipped above was NOTICEd.';
  end if;

  select format('policy %s on %s', policyname, tablename) into offender
  from pg_policies
  where schemaname = 'public' and roles = array['authenticated']::name[]
  limit 1;
  if offender is not null then
    raise exception '0273: a policy for authenticated alone is left: %', offender;
  end if;
end
$$;

NOTIFY pgrst, 'reload schema';
