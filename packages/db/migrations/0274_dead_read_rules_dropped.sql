-- 0274: read rules that no reader can pass are dropped (operator rulings 825 and 835).
--
-- THE DEFECT. Since 0247 no web role writes, and since 0273 `authenticated` reads nothing in
-- `public`. The only web role that reads is `anon`: no account (`auth.uid()` is NULL) and a JWT
-- role of 'anon'. 36 read rules have no branch anon can pass: every branch is a helper that is
-- FALSE for anon (`is_super_admin`, `is_platform_staff` compare the JWT role with 'super_admin';
-- `is_org_member`, `can_manage_league` and the role helpers answer FALSE on a NULL uid), an
-- `= auth.uid()` comparison, or a subquery filtered only by one of those. They look like doors and
-- open for no one (ruling 823 dropped two such referee rules in 0272). Two more rules are `TO
-- service_role`, which bypasses RLS: they never run.
--
-- WHAT CHANGES.
--   1. The 38 rules go. RLS stays on: a table with no rule refuses every row, so anon's answer on
--      each of these tables is unchanged: no rows, except `custom_rulesets`, whose public read rule
--      stays and still shows the built-in and shared rulesets.
--   2. `is_platform_staff()` goes: `platform_roles_select` was its only caller.
--   3. A guard fails the migration if any of it is left, or if any rule in `public` is not a read
--      rule, or names a role that cannot run it (a role with no SELECT on any column of the table,
--      or one that bypasses RLS).
-- Side effect: four of the five helper loops lose their way back, because
-- organization_members, platform_roles, league_user_roles and league_organization_roles no longer
-- carry a rule that calls a helper. `can_manage_penalty_ruleset` over `penalty_rulesets` still
-- loops, for a token with role anon AND an account id (it needs the JWT secret).
--
-- WHAT DOES NOT CHANGE. Every anonymous read (measured on the RLS probe's seed: the same rows on
-- every table before and after). 36 rules remain: 25 call a helper, 3 compensation-plan rules keep
-- a club-member branch beside their public branch (`rcp_read`, `rcrr_read`, `rct_read`), 8 call
-- nothing. Signed-in readers and every writer go through the API.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table, no new function, no grant. Fewer rules, none of which let anyone through.

drop policy "ai_usage_read" on public.ai_usage_log;
drop policy "audit_log_select" on public.audit_log;
drop policy "custom_rulesets_org_owner_read" on public.custom_rulesets;
drop policy "custom_rulesets_super_admin_read" on public.custom_rulesets;
drop policy "deletion_requests_select" on public.deletion_requests;
drop policy "event_broadcast_notifications_select" on public.event_broadcast_notifications;
drop policy "event_broadcast_recipients_select" on public.event_broadcast_recipients;
drop policy "event_instructors_select" on public.event_instructors;
drop policy "epb_read" on public.event_programme_blocks;
drop policy "epc_read" on public.event_programme_configs;
drop policy "follows_select" on public.follows;
drop policy "guest_sessions_select" on public.guest_sessions;
drop policy "league_org_roles_select" on public.league_organization_roles;
drop policy "league_links_select" on public.league_tournament_links;
drop policy "league_user_roles_select" on public.league_user_roles;
drop policy "legal_acceptances_owner_select" on public.legal_acceptances;
drop policy "notification_preferences_select" on public.notification_preferences;
drop policy "org_ai_keys_read" on public.organization_ai_keys;
drop policy "ai_settings_read" on public.organization_ai_settings;
drop policy "org_members_select" on public.organization_members;
drop policy "orgs_select" on public.organizations;
drop policy "person_email_change_requests_select_own" on public.person_email_change_requests;
drop policy "persons_select" on public.persons;
drop policy "platform_ai_usage_super_admin" on public.platform_ai_usage_log;
drop policy "platform_roles_select" on public.platform_roles;
drop policy "pool_assignment_settings_select" on public.pool_assignment_settings;
drop policy "push_subscriptions_select" on public.push_subscriptions;
drop policy "rces_read" on public.referee_compensation_event_settings;
drop policy "rcpay_read" on public.referee_compensation_payments;
drop policy "tournament_penalty_reviews_select" on public.tournament_penalty_reviews;
drop policy "tournament_query_history_org_admin_read" on public.tournament_query_history;
drop policy "tournament_query_history_own_read" on public.tournament_query_history;
drop policy "tournament_query_settings_org_admin_read" on public.tournament_query_settings;
drop policy "workshop_breaks_select" on public.workshop_breaks;
drop policy "workshop_enrollments_select" on public.workshop_enrollments;
drop policy "workshop_feedback_select" on public.workshop_feedback;
drop policy "service_role_all" on public.hema_rating_history;
drop policy "service_role_all" on public.hema_ratings_snapshots;

drop function public.is_platform_staff();

do $$
declare
  offender text;
begin
  select format('policy %s on %s', p.policyname, p.tablename) into offender
  from pg_policies p
  join (values
    ('ai_usage_log', 'ai_usage_read'), ('audit_log', 'audit_log_select'),
    ('custom_rulesets', 'custom_rulesets_org_owner_read'),
    ('custom_rulesets', 'custom_rulesets_super_admin_read'),
    ('deletion_requests', 'deletion_requests_select'),
    ('event_broadcast_notifications', 'event_broadcast_notifications_select'),
    ('event_broadcast_recipients', 'event_broadcast_recipients_select'),
    ('event_instructors', 'event_instructors_select'), ('event_programme_blocks', 'epb_read'),
    ('event_programme_configs', 'epc_read'), ('follows', 'follows_select'),
    ('guest_sessions', 'guest_sessions_select'),
    ('league_organization_roles', 'league_org_roles_select'),
    ('league_tournament_links', 'league_links_select'),
    ('league_user_roles', 'league_user_roles_select'),
    ('legal_acceptances', 'legal_acceptances_owner_select'),
    ('notification_preferences', 'notification_preferences_select'),
    ('organization_ai_keys', 'org_ai_keys_read'), ('organization_ai_settings', 'ai_settings_read'),
    ('organization_members', 'org_members_select'), ('organizations', 'orgs_select'),
    ('person_email_change_requests', 'person_email_change_requests_select_own'),
    ('persons', 'persons_select'), ('platform_ai_usage_log', 'platform_ai_usage_super_admin'),
    ('platform_roles', 'platform_roles_select'),
    ('pool_assignment_settings', 'pool_assignment_settings_select'),
    ('push_subscriptions', 'push_subscriptions_select'),
    ('referee_compensation_event_settings', 'rces_read'),
    ('referee_compensation_payments', 'rcpay_read'),
    ('tournament_penalty_reviews', 'tournament_penalty_reviews_select'),
    ('tournament_query_history', 'tournament_query_history_org_admin_read'),
    ('tournament_query_history', 'tournament_query_history_own_read'),
    ('tournament_query_settings', 'tournament_query_settings_org_admin_read'),
    ('workshop_breaks', 'workshop_breaks_select'),
    ('workshop_enrollments', 'workshop_enrollments_select'),
    ('workshop_feedback', 'workshop_feedback_select'),
    ('hema_rating_history', 'service_role_all'), ('hema_ratings_snapshots', 'service_role_all')
  ) as dead(tablename, policyname)
    on dead.tablename = p.tablename and dead.policyname = p.policyname
  where p.schemaname = 'public'
  limit 1;
  if offender is not null then
    raise exception '0274: a dead read rule is left: %', offender;
  end if;

  if exists (select 1 from pg_proc
             where pronamespace = 'public'::regnamespace and proname = 'is_platform_staff') then
    raise exception '0274: is_platform_staff is left';
  end if;

  select format('policy %s on %s (%s)', p.polname, c.relname, p.polcmd) into offender
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  where c.relnamespace = 'public'::regnamespace and p.polcmd <> 'r'
  limit 1;
  if offender is not null then
    raise exception '0274: a rule in public is not a read rule: %', offender;
  end if;

  -- polroles = {0} is PUBLIC, which a web reader reaches as anon.
  select format('policy %s on %s for %s', p.polname, c.relname, r.role_name) into offender
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  cross join lateral unnest(p.polroles) as pr(oid)
  cross join lateral (select case when pr.oid = 0 then 'anon'
                                  else pg_get_userbyid(pr.oid) end as role_name) r
  where c.relnamespace = 'public'::regnamespace
    and (not has_any_column_privilege(r.role_name, c.oid, 'SELECT')
         or (select rolbypassrls from pg_roles where rolname = r.role_name))
  limit 1;
  if offender is not null then
    raise exception '0274: a rule names a role that cannot run it: %', offender;
  end if;
end
$$;

NOTIFY pgrst, 'reload schema';
