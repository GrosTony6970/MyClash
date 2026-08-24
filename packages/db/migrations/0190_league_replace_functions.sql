-- 0190: replacing a league's stored rows stops being two statements.
--
-- THE DEFECT. Recomputing a league rewrites two tables by deleting everything it
-- owns and inserting the new set. Through PostgREST that is two round trips with
-- no transaction around them, so a failed insert leaves the league with the
-- delete already committed and nothing to show:
--
--   league_rankings          — every standing for the league, gone
--   league_tournament_results — every contribution from one tournament, gone
--
-- leagues.service.ts calls that path "the one path that writes league_rankings",
-- so nothing repairs it until somebody runs another recompute. It is worse than
-- a manual endpoint sounds: recompute also runs unattended, from an event-kind
-- change and from the worker that ticks an event over to completed.
--
-- WHAT CHANGES. One function per table, each holding the delete and the insert.
-- A function body is a single transaction, so a constraint violation in the
-- insert rolls the delete back with it and the previous rows survive. The two
-- statements run in order — this is a plain SQL body, not a data-modifying CTE,
-- because a CTE's sub-statements cannot see one another's effects and the
-- interaction with the UNIQUE index would be a subtlety nobody should have to
-- reason about later.
--
-- Rows arrive as JSONB and are expanded with jsonb_to_recordset. The scoping
-- columns are taken from the PARAMETERS, never from the payload: the delete is
-- scoped by p_league_id, so the insert must be too, or a mismatched payload
-- could write rows the delete never covered.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- SECURITY INVOKER (the default). The API reaches PostgREST only through the
-- service-role client, which is BYPASSRLS, so invoker costs nothing here and
-- means these can never become a way around the league_rankings_all /
-- league_results_all policies from 0015. Same reasoning as 0188 and 0189.
--
-- The three grant statements are all required even though check-db-review.mjs
-- asks them only of a SECURITY DEFINER. Per 0184's header: REVOKE FROM PUBLIC
-- removes only the catch-all grant, while the Supabase image's ALTER DEFAULT
-- PRIVILEGES grants EXECUTE to anon and authenticated BY NAME. Left at the
-- defaults these would be two unauthenticated WRITE endpoints — RLS would make
-- them write nothing, but the insert would raise an RLS error, which is a way to
-- make the database throw on demand. The roles have to be named to be revoked.
--
-- search_path is pinned for the same reason 0188 pins it: an unqualified name
-- inside a function should not be resolvable through the caller's search_path.
--
-- Note the columns are global_person_id, not fighter_id — 0185 renamed both, and
-- check-db-review refuses a migration after it that still says fighter_id.

-- ── The league's standings table ────────────────────────────────────────────

create or replace function public.replace_league_rankings(
  p_league_id uuid,
  p_rows      jsonb
)
returns void
language sql
volatile
set search_path = public, pg_catalog
as $$
  delete from public.league_rankings
   where league_id = p_league_id;

  insert into public.league_rankings (
    league_id,
    ranking_group_key,
    global_person_id,
    rank,
    total_points,
    participation_count,
    medal_count,
    double_hits_total,
    double_hit_average,
    per_tournament
  )
  select
    p_league_id,
    r.ranking_group_key,
    r.global_person_id,
    r.rank,
    r.total_points,
    r.participation_count,
    r.medal_count,
    r.double_hits_total,
    r.double_hit_average,
    r.per_tournament
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
    ranking_group_key   text,
    global_person_id    uuid,
    rank                integer,
    total_points        integer,
    participation_count integer,
    medal_count         integer,
    double_hits_total   integer,
    double_hit_average  text,
    per_tournament      jsonb
  );
$$;

revoke all on function public.replace_league_rankings(uuid, jsonb) from public;

-- Named explicitly: the image grants EXECUTE to these two by name, and a
-- role-specific grant survives a revoke aimed at PUBLIC (see 0184).
revoke execute on function public.replace_league_rankings(uuid, jsonb)
  from anon, authenticated;

grant execute on function public.replace_league_rankings(uuid, jsonb) to service_role;

-- ── One tournament's contributions to a league ──────────────────────────────

create or replace function public.replace_league_tournament_results(
  p_league_id     uuid,
  p_tournament_id uuid,
  p_rows          jsonb
)
returns void
language sql
volatile
set search_path = public, pg_catalog
as $$
  delete from public.league_tournament_results
   where league_id = p_league_id
     and tournament_id = p_tournament_id;

  insert into public.league_tournament_results (
    league_id,
    tournament_id,
    event_id,
    global_person_id,
    ranking_group_key,
    final_rank,
    league_points,
    medal,
    double_hits
  )
  select
    p_league_id,
    p_tournament_id,
    r.event_id,
    r.global_person_id,
    r.ranking_group_key,
    r.final_rank,
    r.league_points,
    r.medal,
    r.double_hits
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
    event_id          uuid,
    global_person_id  uuid,
    ranking_group_key text,
    final_rank        integer,
    league_points     integer,
    medal             text,
    double_hits       integer
  );
$$;

revoke all on function public.replace_league_tournament_results(uuid, uuid, jsonb) from public;

revoke execute on function public.replace_league_tournament_results(uuid, uuid, jsonb)
  from anon, authenticated;

grant execute on function public.replace_league_tournament_results(uuid, uuid, jsonb)
  to service_role;

-- PostgREST caches the schema; without this the first .rpc() call 404s until it
-- reloads on its own.
NOTIFY pgrst, 'reload schema';
