-- 0231: the programme moves only bouts that exist.
--
-- THE DEFECT. The programme writes a whole block of bouts in one round trip: Generate places every
-- bout of a block on a Lice at a time, and a cascade (a running-late shift, a block moved) retimes
-- a day. Both are PostgREST upserts, an `INSERT … ON CONFLICT DO UPDATE`. So:
--   - a bout deleted between the programme's read and its write (a Pool remade, a bracket reseeded)
--     comes back as an empty bout: the upsert inserts the row it no longer finds;
--   - Postgres checks the NOT NULL columns of the row it WOULD insert before it sees the conflict.
--     The upserts carry `phase_id` for that reason alone. The foundation's next migration makes
--     `matches.match_rules_id` NOT NULL (a bout's rules live only in its copy), and every Generate
--     and every shift would fail. Carrying the copy id in the payload would race the stamp: the
--     payload is built from a read taken earlier, and a change of the Tournament's rules between the
--     read and the write would put the bouts not started back on the old copy.
--
-- WHAT CHANGES. Two functions that UPDATE and never insert, each one statement over the rows it is
-- given (jsonb_to_recordset), answering how many bouts it moved:
--   - `programme_place_bouts(p_rows)`: Generate. Each row is {id, scheduled_at, lice_id}; the bout
--     takes its time and its Lice, and loses a typed duration override (the sheet wins when a day is
--     generated again, ADR-018).
--   - `programme_retime_bouts(p_rows)`: a cascade. Each row is {id, scheduled_at}. Only a bout
--     still waiting to be fought moves (`block-move-plan.ts`, "fault 1": a started, finished or
--     voided bout keeps the time it was given). The plan reads that at its read; the write asks it
--     again, so a bout that starts between the read and the write keeps its time (the race).
-- A row whose bout is gone moves nothing, and the count says so (the API reports what MOVED).
-- Triggers: both fire `matches_touch_updated_at` (0181, every update: a retime is a change to the
-- league staleness badge, as with the upsert); place also fires the Lice-of-its-Event refusal
-- (0197) through `lice_id`; neither writes `phase_id` or `match_rules_id`, so 0229's copy trigger
-- does not fire.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- SECURITY INVOKER: the API calls them as the service role (BYPASSRLS); another role meets the
-- `matches` policies. search_path pinned. EXECUTE revoked from public, anon and authenticated BY
-- NAME (the Supabase image grants the two roles by name, 0190's header) and granted to the service
-- role. The ids come from the programme's Event-scoped reads, as the upserts' did; the functions take
-- no Event of their own.

create or replace function public.programme_place_bouts(p_rows jsonb)
returns integer
language sql
volatile
set search_path = public, pg_catalog
as $$
  with moved as (
    update public.matches m
      set scheduled_at = r.scheduled_at,
          lice_id = r.lice_id,
          planned_duration_override_minutes = null
      from jsonb_to_recordset(p_rows) as r(id uuid, scheduled_at timestamptz, lice_id uuid)
      where m.id = r.id
      returning 1
  )
  select count(*)::integer from moved;
$$;

comment on function public.programme_place_bouts(jsonb) is
  'Generate: each bout {id, scheduled_at, lice_id} takes its time and its Lice and loses its typed duration override. Updates only; answers how many bouts moved.';

create or replace function public.programme_retime_bouts(p_rows jsonb)
returns integer
language sql
volatile
set search_path = public, pg_catalog
as $$
  with moved as (
    update public.matches m
      set scheduled_at = r.scheduled_at
      from jsonb_to_recordset(p_rows) as r(id uuid, scheduled_at timestamptz)
      where m.id = r.id
        and m.status = 'scheduled'
      returning 1
  )
  select count(*)::integer from moved;
$$;

comment on function public.programme_retime_bouts(jsonb) is
  'A cascade: each bout {id, scheduled_at} still waiting to be fought takes its new time. Updates only; answers how many bouts moved.';

revoke execute on function public.programme_place_bouts(jsonb) from public, anon, authenticated;
revoke execute on function public.programme_retime_bouts(jsonb) from public, anon, authenticated;
grant execute on function public.programme_place_bouts(jsonb) to service_role;
grant execute on function public.programme_retime_bouts(jsonb) to service_role;

NOTIFY pgrst, 'reload schema';
