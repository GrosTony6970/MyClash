-- 0272: the web roles no longer read fighter profiles through the database's web door
-- (operator rulings 820 and 823).
--
-- THE DEFECT. `global_persons_select` (0187) chose which ROWS of `global_persons` the public sees
-- (claimed fighters listed in the directory) and hid no COLUMN. Anyone holding the public anon key
-- read, through PostgREST, a listed fighter's `email` (0075), `date_of_birth` (0001),
-- `claimed_by_user_id` and the privacy map, a date of birth the fighter chose to hide included:
-- `public_visibility` is honoured by the API only. 0187's own header said the columns were never
-- withheld. 0201 made it reachable in practice: before it, the anonymous helper loop failed the
-- read in any database holding a platform role, as prod does. An error that hid a branch was the
-- only guard, and ending the error woke the branch.
--
-- WHAT CHANGES.
--   1. `anon` and `authenticated` lose SELECT on `global_persons` (named: the image grants by name,
--      and a revoke aimed at PUBLIC leaves a by-name grant).
--   2. `global_persons_select` goes: no web role can read the table, so no branch of it can fire.
--      RLS stays on; a grant that came back would read nothing (no policy = no row).
--   3. `lookup_global_persons` (0114, SECURITY INVOKER) leaves PUBLIC, `anon` and `authenticated`:
--      a web call could only fail on step 1 now. The API calls it as the service role (the fuzzy
--      directory search, which falls back to a plain match in silence on any error), so the
--      service role's EXECUTE is granted by name here, as 0188 and 0217 do, not left to the
--      image's defaults.
--   4. A policy subquery needs SELECT on the table it names, checked when the query starts, even
--      on an empty table and whatever the OR order (measured on postgres:17, 2026-11-16). Three
--      read policies named `global_persons` for the referee's own-row branch
--      (`gp.claimed_by_user_id = auth.uid()`), so step 1 alone would fail every anonymous read of
--      their tables with 42501. That branch never served the public (`auth.uid()` is NULL for
--      anon), and a signed-in reader hits the helper loop first wherever a platform role exists.
--      - `referee_assignments_select` (0204) is recreated without that branch, every other word
--        unchanged: its public branch (published Event, and Tournament for a Pool or bout) stays.
--      - `referee_qualifications_select` and `event_referees_select` (0063) go (ruling 823):
--        without that branch each is `is_super_admin() or is_org_member(...)`, false for anon
--        (0201); a signed-in reader hits the helper loop first wherever a platform role exists,
--        and ruling 821 closes the database's read door to signed-in readers altogether. Both
--        tables keep RLS with no policy: the public reads nothing from them, as before.
--   5. A guard fails the migration if any of this is left undone.
--
-- WHAT DOES NOT CHANGE. No anonymous answer of the three referee tables. Nothing reads
-- `global_persons` through the web door: no browser code calls `.from` or `.rpc`; the table is not
-- in the `supabase_realtime` publication; the two `vw_tournament_query_*` views that join it
-- (fighters, referees) are, like all five, revoked from both web roles (0184); every other function that reads it is revoked from both
-- (`search_public_fighters` 0188, the merges 0212, the FightBook functions 0264 and after). The
-- API reads it as the service role, which keeps every grant.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table, no new function. The web roles hold no read of fighter profiles; the API is the
-- only door to them.

revoke select on public.global_persons from anon, authenticated;

drop policy "global_persons_select" on public.global_persons;

revoke all on function public.lookup_global_persons(text, integer, double precision) from public;
revoke execute on function public.lookup_global_persons(text, integer, double precision)
  from anon, authenticated;
grant execute on function public.lookup_global_persons(text, integer, double precision)
  to service_role;

drop policy "referee_qualifications_select" on referee_qualifications;
drop policy "event_referees_select" on event_referees;

drop policy "referee_assignments_select" on referee_assignments;
create policy "referee_assignments_select" on referee_assignments for select
  using (
    is_super_admin()
    or is_org_member(event_org_id(event_id))
    or (
      exists (
        select 1 from events e
        where e.id = referee_assignments.event_id
          and e.status in ('published','running','completed')
      )
      and (
        referee_assignments.scope_type = 'lice'
        or exists (
          select 1 from pools p
          join phases ph on ph.id = p.phase_id
          join tournaments t on t.id = ph.tournament_id
          where p.id = referee_assignments.pool_id
            and t.status in ('published','running','completed')
        )
        or exists (
          select 1 from matches m
          join phases ph on ph.id = m.phase_id
          join tournaments t on t.id = ph.tournament_id
          where m.id = referee_assignments.match_id
            and t.status in ('published','running','completed')
        )
      )
    )
  );

do $$
declare
  offender text;
  fn constant regprocedure :=
    'public.lookup_global_persons(text, integer, double precision)'::regprocedure;
begin
  select w.role into offender
  from unnest(array['anon', 'authenticated']) as w(role)
  where has_any_column_privilege(w.role, 'public.global_persons'::regclass, 'SELECT')
  limit 1;
  if offender is not null then
    raise exception '0272: % still reads global_persons', offender;
  end if;

  -- has_function_privilege counts PUBLIC's grant: never narrow this to named grantees.
  select w.role into offender
  from unnest(array['anon', 'authenticated']) as w(role)
  where has_function_privilege(w.role, fn, 'EXECUTE')
  limit 1;
  if offender is not null then
    raise exception '0272: % may still call lookup_global_persons', offender;
  end if;

  if not has_function_privilege('service_role', fn, 'EXECUTE') then
    raise exception '0272: the service role may not call lookup_global_persons';
  end if;

  select format('policy %s on %s', policyname, tablename) into offender
  from pg_policies
  where schemaname = 'public'
    and (tablename in ('global_persons', 'referee_qualifications', 'event_referees')
         or coalesce(qual, '') ~ '\mglobal_persons\M'
         or coalesce(with_check, '') ~ '\mglobal_persons\M')
  limit 1;
  if offender is not null then
    raise exception '0272: a policy still reads or guards global_persons: %', offender;
  end if;
end
$$;

NOTIFY pgrst, 'reload schema';
