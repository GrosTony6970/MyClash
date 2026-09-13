-- 0194: replacing one role's referees on a set of Matches stops being two statements.
--
-- THE DEFECT. Setting a Pool's referee for a role (Pools page, Matches tab) deleted that
-- role's match-scoped rows for every Match in the Pool, then inserted new ones: two
-- PostgREST round trips with no transaction around them. The insert copied each Match's
-- Lice onto its row, and referee_assignments_scope_check (0091) requires lice_id NULL on a
-- match-scoped row. So whenever any Match in the Pool had a Lice, the insert failed with a
-- 400 after the delete had already committed. The Pool lost the referee it had, and the
-- save put nothing back.
--
-- The Lice was the common trigger, not the only one. The route does not validate its body,
-- so a referee id that is not a uuid, or that names no global person, fails the insert the
-- same way. So does a connection dropped between the two calls.
--
-- WHAT CHANGES. One function holds the delete and the insert. A function call is one
-- statement, so a failure in the insert rolls the delete back and the previous referee
-- stays. The two statements run in order in a plain SQL body, for the reason 0190 gives: a
-- data-modifying CTE's sub-statements cannot see one another's effects.
--
-- The insert names no lice_id and no pool_id, so both are NULL and the scope CHECK holds by
-- construction rather than by every caller remembering it. A NULL p_person_id deletes and
-- inserts nothing, which is how a role is cleared. The function takes Match ids rather than
-- a Pool id, so a caller holding a single Match can use it too.
--
-- Two organisers saving the same role at the same moment can still leave two referees on
-- it, exactly as the two-call version could: nothing makes (match_id, role) unique. What
-- cannot happen any more is an empty role.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- SECURITY INVOKER, search_path pinned, and all three grant statements, for the reasons
-- 0190 sets out. The API calls it only through the service-role client, which is
-- BYPASSRLS, so invoker costs nothing and the function can never become a way around the
-- referee_assignments RLS policies. The Supabase image grants EXECUTE to anon and
-- authenticated BY NAME, so a revoke aimed at PUBLIC leaves them able to call it (0184);
-- they are revoked by name.

create or replace function public.replace_match_referee_role(
  p_event_id  uuid,
  p_role      text,
  p_person_id uuid,
  p_match_ids uuid[]
)
returns void
language sql
volatile
set search_path = public, pg_catalog
as $$
  delete from public.referee_assignments
   where scope_type = 'match'
     and role = p_role
     and match_id = any(p_match_ids);

  insert into public.referee_assignments (
    event_id,
    person_id,
    scope_type,
    match_id,
    role,
    auto_assigned,
    status,
    conflicts_jsonb
  )
  select
    p_event_id,
    p_person_id,
    'match',
    m.match_id,
    p_role,
    false,
    'assigned',
    '[]'::jsonb
  from unnest(p_match_ids) as m(match_id)
  where p_person_id is not null;
$$;

revoke all on function public.replace_match_referee_role(uuid, text, uuid, uuid[]) from public;

-- Named explicitly: the image grants EXECUTE to these two by name, and a role-specific
-- grant survives a revoke aimed at PUBLIC (see 0184).
revoke execute on function public.replace_match_referee_role(uuid, text, uuid, uuid[])
  from anon, authenticated;

grant execute on function public.replace_match_referee_role(uuid, text, uuid, uuid[])
  to service_role;

-- PostgREST caches the schema; without this the first .rpc() call 404s until it reloads on
-- its own.
NOTIFY pgrst, 'reload schema';
