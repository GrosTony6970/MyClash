-- 0247: no table takes a write through the database's web door, and a new table starts closed
-- (operator rulings 98, 226, 227 and 229, the 0216/0233/0238 pattern for every table at once).
--
-- THE DEFECT. 62 tables of `public` still held, for `anon` and `authenticated`, the INSERT,
-- UPDATE and DELETE grants of the image's default privileges (four without DELETE since 0237
-- and 0238: `events`, `organizations`, `phases`, `registrations`) AND 76 write policies (0002 and
-- after) that let a signed-in user write through PostgREST, past every door of the API. Only the
-- RLS helper loop stopped them (ruling 111a leaves it latent): with the helpers made SECURITY
-- DEFINER, an organisation admin INSERTs an `organization_members` row making another account the
-- club's owner (`org_members_insert` checks `has_org_role(org, 'admin')` only), rewrites a Pool, a
-- bracket slot, a piste, a referee payment or a staff account, and a super admin writes
-- `platform_roles` and the AI keys past the API's audit line. Every other table had RLS and no
-- write policy, but kept the grants: a web UPDATE or DELETE touched no row in silence, and an
-- INSERT failed on RLS, never on privilege. And
-- the default privileges of `public` handed every NEW table the same grants, so each later
-- migration had to remember to close its own.
--
-- WHAT CHANGES.
--   1. The 76 write policies go (INSERT, UPDATE, DELETE and FOR ALL, every one whose roles are
--      `public` or `authenticated`). A FOR ALL policy also granted SELECT; ruling 227 accepts the
--      narrowing. 15 tables then have no policy at all and nobody reads them through PostgREST:
--      `ai_data_quality_findings`, `ai_data_quality_scans`, `club_review_requests`,
--      `directory_follows`, `directory_group_members`, `directory_groups`, `event_arrivals`,
--      `event_gear_checks`, `event_staff_accounts`, `event_staff_lice_assignments`,
--      `feature_flags`, `organization_follows`, `platform_ai_keys`, `platform_ai_settings`,
--      `ruleset_submissions`. Every FOR ALL policy's condition needed a signed-in identity, so no
--      anonymous read changes.
--   2. 0224's Event-move trigger, its function and its helper go (ruling 229, as 0233 dropped the
--      two Tournament triggers, ruling "0224 triggers"): the trigger let the service role and
--      direct logins through and refused only a web writer, and no web role may write `events`
--      now. The API never moves an Event to another club. The unique index on
--      `custom_rulesets(code)` stays.
--   3. INSERT, UPDATE and DELETE leave `anon`, `authenticated` and PUBLIC on every relation of
--      `public` (column grants of the same kind go with them). PostgREST then refuses a web write
--      on privilege (42501), loudly.
--   4. The default privileges of `postgres` and `supabase_admin` in `public`, and their global
--      ones, no longer give the two roles (or PUBLIC) a write on a new table. A role the running
--      user may not act for is skipped with a NOTICE; the guard below then fails if it held such
--      a default. On a Supabase-image database that means: run the migrations as
--      `supabase_admin` (a superuser), as prod's `POSTGRES_USER` does, never as `postgres`.
--   5. A guard fails the migration if any web write policy, web write privilege or web write
--      default privilege is left (a REVOKE by a non-owner is only a WARNING).
--   Both roles keep SELECT and, as 0216, 0227, 0233 and 0238 left them, TRUNCATE, REFERENCES,
--   TRIGGER and MAINTAIN (PostgREST has no verb for them; both roles are NOLOGIN), and their
--   sequence privileges (no table write).
--
-- WHAT DOES NOT CHANGE. Every read policy, so the public pages and Realtime (anon) read what they
-- read before. No app writes through PostgREST: the browsers' Supabase clients are anon and serve
-- Realtime only, and the API writes as the service role, which keeps every grant. The penalty-pin
-- triggers of 0199 stay: they exempt no role, so they now check the API's writes alone. Three
-- SECURITY INVOKER functions that write (`set_active_fighter_ai_key`, `set_active_org_ai_key`,
-- `set_active_platform_ai_key`) keep their EXECUTE for both roles: they run with the caller's
-- rights, which no longer reach their tables. No table is altered and no row is written.
--
-- STILL OPEN, named: the helper loop itself (ruling 228, its own slice); it now guards no write,
-- and still turns a signed-in read into an error.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table, no new function. For writes, privilege is the boundary: the web roles hold none.
-- RLS stays the boundary for reads.

-- No IF EXISTS on the old names: a mistyped one must fail the replay (0216's rule).
drop policy ai_data_quality_findings_super_admin on public.ai_data_quality_findings;
drop policy ai_data_quality_scans_super_admin on public.ai_data_quality_scans;
drop policy bracket_slots_write on public.bracket_slots;
drop policy club_review_requests_service_role_all on public.club_review_requests;
drop policy clubs_insert on public.clubs;
drop policy clubs_update on public.clubs;
drop policy deletion_requests_insert on public.deletion_requests;
drop policy deletion_requests_update_cancel on public.deletion_requests;
drop policy deletion_requests_update_review on public.deletion_requests;
drop policy directory_follows_owner_all on public.directory_follows;
drop policy directory_group_members_owner_all on public.directory_group_members;
drop policy directory_groups_owner_all on public.directory_groups;
drop policy "Org editors manage event arrivals" on public.event_arrivals;
drop policy "Org editors manage event gear checks" on public.event_gear_checks;
drop policy event_instructors_write on public.event_instructors;
drop policy epb_write on public.event_programme_blocks;
drop policy epc_write on public.event_programme_configs;
drop policy event_referees_write on public.event_referees;
drop policy "Org editors manage event staff accounts" on public.event_staff_accounts;
drop policy "Org editors manage event staff lice assignments" on public.event_staff_lice_assignments;
drop policy events_insert on public.events;
drop policy events_update on public.events;
drop policy "Org admins create exchange edit requests" on public.exchange_edit_requests;
drop policy "Super admins manage exchange edit requests" on public.exchange_edit_requests;
drop policy feature_flags_super_admin_all on public.feature_flags;
drop policy fighter_clubs_write on public.fighter_clubs;
drop policy fighter_weapons_write on public.fighter_weapons;
drop policy follows_delete on public.follows;
drop policy follows_insert on public.follows;
drop policy global_persons_insert on public.global_persons;
drop policy global_persons_update on public.global_persons;
drop policy lices_write on public.lices;
drop policy notification_preferences_write on public.notification_preferences;
drop policy org_ai_keys_write on public.organization_ai_keys;
drop policy ai_settings_write on public.organization_ai_settings;
drop policy organization_follows_owner_all on public.organization_follows;
drop policy org_members_delete on public.organization_members;
drop policy org_members_insert on public.organization_members;
drop policy org_members_update on public.organization_members;
drop policy orgs_insert on public.organizations;
drop policy orgs_update on public.organizations;
drop policy persons_delete on public.persons;
drop policy persons_insert on public.persons;
drop policy persons_update on public.persons;
drop policy phases_write on public.phases;
drop policy platform_ai_keys_super_admin on public.platform_ai_keys;
drop policy platform_ai_settings_super_admin on public.platform_ai_settings;
drop policy platform_roles_delete on public.platform_roles;
drop policy platform_roles_insert on public.platform_roles;
drop policy platform_roles_update on public.platform_roles;
drop policy pool_assignment_settings_write on public.pool_assignment_settings;
drop policy pool_members_write on public.pool_members;
drop policy pools_write on public.pools;
drop policy push_subscriptions_write on public.push_subscriptions;
drop policy rces_write on public.referee_compensation_event_settings;
drop policy rcpay_write on public.referee_compensation_payments;
drop policy rcp_write on public.referee_compensation_plans;
drop policy rcrr_write on public.referee_compensation_role_rates;
drop policy rct_write on public.referee_compensation_tiers;
drop policy referee_profiles_write on public.referee_profiles;
drop policy referee_qualifications_write on public.referee_qualifications;
drop policy referee_skills_write on public.referee_skills;
drop policy registrations_write on public.registrations;
drop policy ruleset_submissions_super_admin_all on public.ruleset_submissions;
drop policy swiss_entrants_write on public.swiss_entrants;
drop policy swiss_rounds_write on public.swiss_rounds;
drop policy themes_write on public.themes;
drop policy tournament_penalty_reviews_all on public.tournament_penalty_reviews;
drop policy tournament_query_settings_org_admin_write on public.tournament_query_settings;
drop policy weapon_catalog_write on public.weapon_catalog;
drop policy workshop_breaks_write on public.workshop_breaks;
drop policy workshop_enrollments_write on public.workshop_enrollments;
drop policy workshop_feedback_write on public.workshop_feedback;
drop policy workshop_instructors_write on public.workshop_instructors;
drop policy workshop_sessions_write on public.workshop_sessions;
drop policy workshops_write on public.workshops;

-- Ruling 229: the trigger first, then its function, then the helper only it called.
drop trigger events_ruleset_pairs_follow_move on public.events;
drop function public.ruleset_pairs_follow_event_move();
drop function public.ruleset_code_offered_to(text, uuid);

revoke insert, update, delete on all tables in schema public from anon, authenticated, public;

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
      raise notice '0247: % may not change the default privileges of %; skipped', current_user, r;
      continue;
    end if;
    execute format(
      'alter default privileges for role %I in schema public revoke insert, update, delete on tables from anon, authenticated, public',
      r);
    execute format(
      'alter default privileges for role %I revoke insert, update, delete on tables from anon, authenticated, public',
      r);
  end loop;
end
$$;

do $$
declare
  offender text;
begin
  select format('policy %s on %s', policyname, tablename) into offender
  from pg_policies
  where schemaname = 'public' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    and roles && array['anon', 'authenticated', 'public']::name[]
  limit 1;
  if offender is not null then
    raise exception '0247: a web write policy is left: %', offender;
  end if;

  select format('%s on %s', w.role, c.relname) into offender
  from pg_class c
  cross join unnest(array['anon', 'authenticated']) as w(role)
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and not exists (select 1 from pg_depend d
                    where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
    and (has_any_column_privilege(w.role, c.oid, 'INSERT')
         or has_any_column_privilege(w.role, c.oid, 'UPDATE')
         or has_table_privilege(w.role, c.oid, 'DELETE'))
  limit 1;
  if offender is not null then
    raise exception '0247: a web write privilege is left: %', offender;
  end if;

  select format('%s for new tables of %s',
                case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
                pg_get_userbyid(d.defaclrole))
    into offender
  from pg_default_acl d
  cross join aclexplode(d.defaclacl) as a
  where d.defaclobjtype = 'r'
    and d.defaclnamespace in (0, 'public'::regnamespace)
    and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
  limit 1;
  if offender is not null then
    raise exception '0247: a web write default privilege is left: %', offender
      using hint = 'Run the migrations as a superuser (supabase_admin on the Supabase image), '
        'or as a member of the role named; a role skipped above was NOTICEd.';
  end if;
end
$$;
