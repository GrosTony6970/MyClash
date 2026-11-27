-- 0289: a team Tournament takes no double elimination and no Swiss phase, even in a race (team
-- Tournaments, slice 1c-1; rulings 996 and 1007).
--
-- A team Tournament runs its Pools and a single elimination bracket; double elimination and Swiss
-- have no team path (ADR-022). The API refuses both before the write, but it reads the Tournament's
-- kind several reads before the phase's insert (the entrant count, the ruleset stamp, the replace
-- of an old bracket). An organiser could generate a double elimination bracket for an empty
-- individual Tournament while another switched it to team: the switch committed first, the API's
-- check had already passed, and the bracket landed on a team Tournament. 0288's phase trigger took
-- the lock that orders the two writes but refused nothing. The operator's ruling 996: the database
-- refuses it. Ruling 1007: only double elimination and Swiss; a single elimination bracket seeded
-- by rating is not refused here (slice 1c-2b gives a team a rating).
--
-- WHAT CHANGES.
--   1. `phase_fits_entrant_kind()`, BEFORE INSERT OR UPDATE OF tournament_id, type on `phases`,
--      reads the phase's Tournament's kind FOR SHARE, as 0288's `phase_locks_entrant_kind` did, and
--      refuses a `double_elim` or a `swiss` phase when the kind is 'team'. It fires on a change of
--      `type` too, so a team Tournament's single elimination phase cannot become a double
--      elimination one (no API path writes `phases.type` after the insert today). With no
--      Tournament found it lets the row on, and the foreign key refuses it with its own error
--      (23503). It refuses with SQLSTATE 23514 and its name as the constraint. The message STARTS
--      with that name and a colon: PostgREST does not pass the constraint name on, so the API's
--      `entrantKindRefusal` (`apps/api/src/common/entrant-kind-refusal.ts`) matches the prefix and
--      answers 409 `team_tournament_not_supported`, the reason the API's own check says.
--   2. 0288's `phase_locks_entrant_kind` trigger and function are dropped: the new one takes the
--      same lock, so 0288's race (a switch while a phase is added) still waits and is still refused
--      by `entrant_kind_set_before_phases`. It is the only trigger on `phases`.
--
-- THE RACE. A phase and a switch to team can arrive at once. A running switch holds the Tournament
-- FOR NO KEY UPDATE, which conflicts with the phase's FOR SHARE: the phase waits for it, then reads
-- the kind as the switch left it, 'team', and is refused. (The phase's foreign key takes only FOR
-- KEY SHARE, which a switch does not block.) A phase already being written holds its FOR SHARE, so
-- the switch waits for it and is refused by 0288's `entrant_kind_set_before_phases`. The argument
-- assumes READ COMMITTED, which the API and PostgREST use. This is 0287's argument, for a phase in
-- place of a League link.
--
-- WHAT DOES NOT CHANGE. No data: a phase already on a Tournament stays, whatever its type. No
-- table, no column, no rule, no grant on a table.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- One new trigger function, SECURITY INVOKER, pinned search_path, closed to the web roles (execute
-- revoked from public, anon and authenticated, granted to service_role). No new table; RLS on
-- `phases` is as it was.

create or replace function public.phase_fits_entrant_kind()
returns trigger
language plpgsql
volatile
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_kind text;
begin
  select t.entrant_kind into v_kind
    from public.tournaments t
   where t.id = new.tournament_id
     for share;
  -- Only the owner and service_role write this table (0247), so "not found" means no row: the
  -- foreign key refuses it (23503).
  if not found then
    return new;
  end if;
  if v_kind = 'team' and new.type in ('double_elim', 'swiss') then
    raise exception 'phase_fits_entrant_kind: a team Tournament takes no % phase, and Tournament % is a team one',
      new.type, new.tournament_id
      using errcode = 'check_violation', constraint = 'phase_fits_entrant_kind',
            table = tg_table_name, schema = tg_table_schema;
  end if;
  return new;
end;
$$;

comment on function public.phase_fits_entrant_kind() is
  'Holds a phase''s Tournament FOR SHARE and refuses a double elimination or Swiss phase on a team Tournament (0289, rulings 996 and 1007).';

revoke execute on function public.phase_fits_entrant_kind() from public, anon, authenticated;
grant execute on function public.phase_fits_entrant_kind() to service_role;

drop trigger if exists phase_locks_entrant_kind on public.phases;
drop function if exists public.phase_locks_entrant_kind();

drop trigger if exists phase_fits_entrant_kind on public.phases;
create trigger phase_fits_entrant_kind
  before insert or update of tournament_id, type on public.phases
  for each row
  execute function public.phase_fits_entrant_kind();

-- Prove it landed, from the catalog only (it also runs on production: no row is written). The new
-- trigger once on `phases`, on both columns; the old trigger and function gone; the new function
-- VOLATILE and closed to the web roles.
do $$
declare
  v_attrs text[];
begin
  select array_agg(a.attname::text order by a.attname) into v_attrs
    from pg_trigger t
    join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = any(t.tgattr)
   where t.tgrelid = 'public.phases'::regclass and t.tgname = 'phase_fits_entrant_kind'
     and not t.tgisinternal;
  if (select count(*) from pg_trigger t
       where t.tgrelid = 'public.phases'::regclass and t.tgname = 'phase_fits_entrant_kind'
         and not t.tgisinternal) <> 1
     or v_attrs is distinct from array['tournament_id', 'type'] then
    raise exception '0289: phase_fits_entrant_kind is not one trigger on phases.tournament_id and phases.type (columns %)',
      v_attrs;
  end if;

  if exists (select 1 from pg_trigger t
              where t.tgrelid = 'public.phases'::regclass and t.tgname = 'phase_locks_entrant_kind')
     or exists (select 1 from pg_proc p
                 where p.pronamespace = 'public'::regnamespace
                   and p.proname = 'phase_locks_entrant_kind') then
    raise exception '0289: 0288''s phase_locks_entrant_kind is still there';
  end if;

  if not exists (select 1 from pg_proc p
                  where p.pronamespace = 'public'::regnamespace
                    and p.proname = 'phase_fits_entrant_kind'
                    and p.provolatile = 'v'
                    and not p.prosecdef
                    and not has_function_privilege('anon', p.oid, 'execute')
                    and not has_function_privilege('authenticated', p.oid, 'execute')) then
    raise exception '0289: phase_fits_entrant_kind is not VOLATILE, not SECURITY INVOKER, or open to a web role';
  end if;
end
$$;

notify pgrst, 'reload schema';
