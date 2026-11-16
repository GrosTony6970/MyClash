-- 0275: the web roles run only the helpers the read rules call (operator ruling 826).
--
-- THE DEFECT. Every function made in `public` started executable by PUBLIC (Postgres's built-in
-- default) and by anon, authenticated and service_role by name (the default privileges of
-- `postgres` and `supabase_admin`). Only the ones a migration revoked by hand were closed, so
-- anyone holding the public key could call, over /rest/v1/rpc, every other function the API uses
-- (the fighter stats, the club lookup, ...) and those of the extensions that live in `public`
-- (pg_trgm's `set_limit` changes a setting of a pooled session). A volunteer who adds a function
-- and forgets the two revokes opens it the day it lands,
-- and nothing read the function list the way checks 20 and 22 read the tables. The only sequence
-- in `public` gave both web roles USAGE and UPDATE (setval).
--
-- WHAT CHANGES.
--   1. service_role is granted EXECUTE on every routine of `public` by name: its access no longer
--      leans on PUBLIC for any function whose ACL is ever reset (none does today).
--   2. PUBLIC, anon and authenticated lose EXECUTE on every routine of `public`, extension members
--      included (`pg_trgm`, `unaccent`; on a plain postgres:17 also `pg_stat_statements`).
--   3. anon gets EXECUTE back on exactly the helpers the read rules call, derived from the catalogue,
--      not listed: every function in `public` a rule on a `public` table depends on, closed over
--      the functions those call (pg_depend, or a call of the function's name in its body). Policy
--      evaluation runs as the reader and checks EXECUTE even on a branch that never runs, so these
--      must stay. A VIEW anon reads that calls a `public` function is not in this list: it would
--      need a ruling (none of ours does; on a plain postgres:17 the two `pg_stat_statements`
--      views stay readable by anon, but reading them is now refused on the functions they
--      call). Today
--      that is is_super_admin, is_org_member, event_org_id, can_manage_league,
--      has_league_user_role, has_league_org_role, can_manage_penalty_ruleset, has_org_role and
--      match_penalty_event_org_id. The body match is text: a name in a comment or a string would
--      also be granted (RLS probe check 24 catches a grant no read needs).
--   4. PUBLIC, anon and authenticated lose every privilege on the sequences of `public`.
--   5. New routines and sequences start closed: the default privileges of `postgres` and
--      `supabase_admin` no longer give anon or authenticated EXECUTE or sequence rights in `public`,
--      and no longer give PUBLIC EXECUTE on new functions anywhere but `realtime` (Postgres's PUBLIC
--      grant is a global default; a per-schema revoke cannot remove it, so it goes globally and
--      comes back for `realtime` alone, ruling 838: Realtime creates its own functions there after
--      the migrations, as supabase_admin, and its broadcast and private channels rely on PUBLIC).
--      service_role keeps its by-name default in `public`.
--   6. A guard fails the migration if any of it is left.
--
-- WHAT THIS MEANS FOR LATER MIGRATIONS.
--   - A new read rule that calls a NEW helper must `grant execute on function <it> to anon`, or
--     every anonymous read of that table fails (probe checks 1 and 24 go red).
--   - A function or extension created outside `public` and `realtime` (by postgres or
--     supabase_admin) no longer gets PUBLIC's EXECUTE: it gets only what that schema's own default
--     privileges name. In a new schema, or `auth` and `vault`, that is its owner alone: grant
--     service_role (and anon, if a read rule needs it) by name. On the Supabase image `graphql`,
--     `graphql_public` and (for postgres) `storage` still give the web roles new functions by name,
--     and `extensions` gives postgres (out of scope; prod's PostgREST serves `public` only).
--     Measured on a fresh deploy: without the `realtime` default, six of Realtime's functions
--     (send, topic, broadcast_changes, ...) started closed to anon.
--   - A function in `public` keeps service_role's EXECUTE (check 24): the old "migration-only
--     function granted to no role" pattern (0229) would need a ruling.
--   - Every non-web role of the Supabase image except postgres (authenticator, the auth, storage,
--     replication and ETL admins, the read-only user, dashboard_user, ...) reached `public`'s
--     functions only through PUBLIC; none calls one.
--
-- WHAT DOES NOT CHANGE. Every anonymous read and the live channel: the helpers keep their grant
-- (measured on the RLS probe's seed: every relation anon reads answers the same rows). The API runs
-- as service_role. Trigger functions fire whatever the writer's EXECUTE.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table, no new function. For functions, anon may run only what its read rules need;
-- authenticated and PUBLIC run nothing in `public`; a new function or sequence starts closed.

grant execute on all routines in schema public to service_role;

revoke execute on all routines in schema public from public;
revoke execute on all routines in schema public from anon, authenticated;

do $$
declare
  fn regprocedure;
begin
  for fn in
    with recursive helpers(oid) as (
      select distinct p.oid
      from pg_policy pol
      join pg_class rel on rel.oid = pol.polrelid and rel.relnamespace = 'public'::regnamespace
      join pg_depend d on d.classid = 'pg_policy'::regclass and d.objid = pol.oid
                      and d.refclassid = 'pg_proc'::regclass
      join pg_proc p on p.oid = d.refobjid and p.pronamespace = 'public'::regnamespace
      union
      select callee.oid
      from helpers h
      join pg_proc caller on caller.oid = h.oid
      join pg_proc callee on callee.pronamespace = 'public'::regnamespace
      where exists (select 1 from pg_depend d
                    where d.classid = 'pg_proc'::regclass and d.objid = caller.oid
                      and d.refclassid = 'pg_proc'::regclass and d.refobjid = callee.oid)
         or caller.prosrc ~* ('(^|[^.[:alnum:]_"])' || callee.proname || '\s*\(')
         or caller.prosrc ~* ('public\.' || callee.proname || '\s*\(')
    )
    select oid::regprocedure from helpers
  loop
    execute format('grant execute on function %s to anon', fn);
  end loop;
end
$$;

revoke all on all sequences in schema public from public, anon, authenticated;

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
      raise notice '0275: % may not change the default privileges of %; skipped', current_user, r;
      continue;
    end if;
    execute format(
      'alter default privileges for role %I revoke execute on functions from public', r);
    execute format(
      'alter default privileges for role %I in schema public revoke execute on functions from anon, authenticated',
      r);
    execute format(
      'alter default privileges for role %I in schema public revoke all on sequences from anon, authenticated',
      r);
    -- Ruling 838: Realtime creates its own functions in `realtime` after the migrations, as
    -- supabase_admin (postgres gets the same default, for symmetry); they keep PUBLIC's EXECUTE,
    -- as Supabase ships them (broadcast, private channels). The Supabase image makes the schema
    -- before the migrations; only a plain Postgres (the CI replay) has none.
    if to_regnamespace('realtime') is not null then
      execute format(
        'alter default privileges for role %I in schema realtime grant execute on functions to public',
        r);
    elsif r = 'supabase_admin' then
      raise exception '0275: the Supabase image has no realtime schema yet: Realtime would make '
        'its functions after this default and they would start closed (ruling 838)';
    else
      raise notice '0275: no realtime schema; % keeps no default for it', r;
    end if;
  end loop;
end
$$;

do $$
declare
  offender text;
begin
  select format('%s for %s', p.oid::regprocedure, r.who) into offender
  from pg_proc p
  cross join (values ('authenticated'), ('public')) as r(who)
  where p.pronamespace = 'public'::regnamespace
    and has_function_privilege(r.who, p.oid, 'EXECUTE')
  limit 1;
  if offender is not null then
    raise exception '0275: a web role still runs a function: %', offender;
  end if;

  with recursive helpers(oid) as (
    select distinct p.oid
    from pg_policy pol
    join pg_class rel on rel.oid = pol.polrelid and rel.relnamespace = 'public'::regnamespace
    join pg_depend d on d.classid = 'pg_policy'::regclass and d.objid = pol.oid
                    and d.refclassid = 'pg_proc'::regclass
    join pg_proc p on p.oid = d.refobjid and p.pronamespace = 'public'::regnamespace
    union
    select callee.oid
    from helpers h
    join pg_proc caller on caller.oid = h.oid
    join pg_proc callee on callee.pronamespace = 'public'::regnamespace
    where exists (select 1 from pg_depend d
                  where d.classid = 'pg_proc'::regclass and d.objid = caller.oid
                    and d.refclassid = 'pg_proc'::regclass and d.refobjid = callee.oid)
       or caller.prosrc ~* ('(^|[^.[:alnum:]_"])' || callee.proname || '\s*\(')
       or caller.prosrc ~* ('public\.' || callee.proname || '\s*\(')
  )
  select format('%s (%s)', p.oid::regprocedure,
                case when h.oid is null then 'anon runs it, no read rule needs it'
                     else 'a read rule needs it, anon cannot run it' end)
    into offender
  from pg_proc p
  left join helpers h on h.oid = p.oid
  where p.pronamespace = 'public'::regnamespace
    and has_function_privilege('anon', p.oid, 'EXECUTE') <> (h.oid is not null)
  limit 1;
  if offender is not null then
    raise exception '0275: anon runs the wrong functions: %', offender;
  end if;

  select p.oid::regprocedure::text into offender
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and not has_function_privilege('service_role', p.oid, 'EXECUTE')
  limit 1;
  if offender is not null then
    raise exception '0275: service_role cannot run %', offender;
  end if;

  select format('%s for %s', c.oid::regclass, r.who) into offender
  from pg_class c
  cross join (values ('anon'), ('authenticated'), ('public')) as r(who)
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
    and has_sequence_privilege(r.who, c.oid, 'USAGE, SELECT, UPDATE')
  limit 1;
  if offender is not null then
    raise exception '0275: a web role may still use a sequence: %', offender;
  end if;

  select r.rolname into offender
  from pg_roles r
  where r.rolname in ('postgres', 'supabase_admin')
    and exists (
      select 1 from aclexplode(coalesce(
        (select d.defaclacl from pg_default_acl d
         where d.defaclrole = r.oid and d.defaclnamespace = 0 and d.defaclobjtype = 'f'),
        acldefault('f', r.oid))) a
      where a.grantee = 0 and a.privilege_type = 'EXECUTE')
  limit 1;
  if offender is not null then
    raise exception '0275: new functions of % still give PUBLIC EXECUTE', offender
      using hint = 'Run the migrations as a superuser (supabase_admin on the Supabase image), '
        'or as a member of the role named; a role skipped above was NOTICEd.';
  end if;

  select format('%s (%s)', pg_get_userbyid(d.defaclrole), d.defaclobjtype) into offender
  from pg_default_acl d
  cross join aclexplode(d.defaclacl) as a
  where d.defaclobjtype in ('f', 'S')
    and d.defaclnamespace in (0, 'public'::regnamespace)
    and a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole)
  limit 1;
  if offender is not null then
    raise exception '0275: a default privilege still gives a web role a new function or sequence: %',
      offender
      using hint = 'Run the migrations as a superuser (supabase_admin on the Supabase image), '
        'or as a member of the role named; a role skipped above was NOTICEd.';
  end if;

  select r.rolname into offender
  from pg_roles r
  where r.rolname in ('postgres', 'supabase_admin')
    and to_regnamespace('realtime') is not null
    and not exists (
      select 1 from pg_default_acl d cross join aclexplode(d.defaclacl) a
      where d.defaclrole = r.oid and d.defaclnamespace = to_regnamespace('realtime')
        and d.defaclobjtype = 'f' and a.grantee = 0 and a.privilege_type = 'EXECUTE')
  limit 1;
  if offender is not null then
    raise exception '0275: new functions of % in realtime no longer give PUBLIC EXECUTE', offender;
  end if;
end
$$;

NOTIFY pgrst, 'reload schema';
