-- 0207: replacing one role's referees on a set of Matches keeps the reasons confirmed over.
--
-- THE GAP. Every door that writes a referee now asks the one referee checker (ADR-016). A
-- Discouraged reason the organiser confirmed over is stored on the row, in
-- referee_assignments.conflicts_jsonb, as { code, label } pairs: the board shows it grey
-- ("confirmed over") and a NEW reason amber (ruling 135). The per-bout and per-Pool crew
-- doors of the Pools page write through replace_match_referee_role (0194), which writes
-- '[]' into that column whatever was confirmed. So a confirmed assignment made there came
-- back amber on the next read, as if nobody had confirmed it.
--
-- WHAT CHANGES. The function takes the reasons as a fifth argument, p_conflicts, and writes
-- them on every row it inserts. The body is otherwise 0194's: one statement, delete then
-- insert, so a failed insert rolls the delete back.
--
-- The 4-argument version is DROPPED, not left beside the new one. PostgREST picks an
-- overload by the argument names it is sent; with both present, a call naming the first
-- four matches both (the fifth has a default) and PostgREST refuses it (PGRST203).
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- As 0194: SECURITY INVOKER, search_path pinned, and all three grant statements. The API
-- calls it only through the service-role client. The Supabase image grants EXECUTE to anon
-- and authenticated BY NAME on every new function, so a revoke aimed at PUBLIC leaves them
-- able to call it (0184); they are revoked by name, on the new signature.

drop function if exists public.replace_match_referee_role(uuid, text, uuid, uuid[]);

create or replace function public.replace_match_referee_role(
  p_event_id  uuid,
  p_role      text,
  p_person_id uuid,
  p_match_ids uuid[],
  p_conflicts jsonb default '[]'::jsonb
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
    coalesce(p_conflicts, '[]'::jsonb)
  from unnest(p_match_ids) as m(match_id)
  where p_person_id is not null;
$$;

revoke all on function public.replace_match_referee_role(uuid, text, uuid, uuid[], jsonb)
  from public;

-- Named explicitly: the image grants EXECUTE to these two by name, and a role-specific
-- grant survives a revoke aimed at PUBLIC (see 0184).
revoke execute on function public.replace_match_referee_role(uuid, text, uuid, uuid[], jsonb)
  from anon, authenticated;

grant execute on function public.replace_match_referee_role(uuid, text, uuid, uuid[], jsonb)
  to service_role;

NOTIFY pgrst, 'reload schema';
