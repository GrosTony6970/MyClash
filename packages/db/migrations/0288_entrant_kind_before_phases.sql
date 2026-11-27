-- 0288: a Tournament's kind is fixed once it has a phase (team Tournaments, slice 1c-1; ruling 989).
--
-- A Tournament is individual or team (0281), and its kind was fixed only once it held an entrant.
-- An organiser could build a double elimination bracket for an empty individual Tournament, then
-- switch it to team: the teams then sat in a bracket a team Tournament refuses everywhere else, and
-- a bracket seeded by rating never filled. The operator's ruling 989: the switch individual <-> team
-- is refused once the Tournament has a phase (its Pools, a Swiss phase or a bracket), not only once
-- it has an entrant, and the database judges it, as it judges the entrant lock.
--
-- WHAT CHANGES.
--   1. `entrant_kind_set_before_phases()`, AFTER UPDATE OF entrant_kind on `tournaments`, WHEN the
--      kind really changes, refuses the change while a phase of the Tournament exists. A save that
--      sends the same kind again never reaches it.
--      It is a trigger of its own, not a new branch of 0281's `entrant_kind_is_settled`: the two
--      refusals ask the organiser for different things (remove the entrants; delete the Pools and
--      the bracket), so each raises its own name and the API names each. Triggers of one event fire
--      in name order: `entrant_kind_is_settled` first, then this one, then 0287's
--      `league_link_blocks_team`. A Tournament with an entrant and a phase is refused for its
--      entrants.
--      It refuses with SQLSTATE 23514 and its name as the constraint. The message STARTS with that
--      name and a colon: PostgREST does not pass the constraint name on, so the API's
--      `entrantKindRefusal` (`apps/api/src/common/entrant-kind-refusal.ts`) matches the prefix.
--   2. `phase_locks_entrant_kind()`, BEFORE INSERT OR UPDATE OF tournament_id on `phases`, reads the
--      phase's Tournament FOR SHARE and refuses nothing: it is the lock of THE RACE below. With no
--      Tournament found it lets the row on, and the foreign key refuses it with its own error
--      (23503).
--
-- THE RACE. A phase and a change of kind can arrive at once. The phase's foreign key takes only
-- FOR KEY SHARE on its Tournament, which a change of kind (FOR NO KEY UPDATE) does not block: a
-- phase still being written is invisible to the change's check, so both would commit and the
-- Tournament would hold a phase of the other kind. `phase_locks_entrant_kind` takes FOR SHARE,
-- which conflicts with FOR NO KEY UPDATE. A change already running holds the row, so the phase waits
-- for it and is written after it: no phase existed when the change was judged, so the change was
-- right. A phase already being written holds its FOR SHARE, so the change waits for it; the change
-- is checked AFTER its own row lock, by a VOLATILE function, so its query takes a new snapshot and
-- sees that phase, and is refused. A BEFORE UPDATE check would read before the lock and miss it.
-- Whether the phase itself fits the kind (a team Tournament takes no double elimination) is the
-- API's check, made before the write. The FOR SHARE could deadlock two transactions that each add a
-- phase and then update its Tournament; no path does both in one transaction (the API writes one
-- statement per request, and no database function inserts a phase). The argument assumes READ
-- COMMITTED, which the API and PostgREST use: under REPEATABLE READ the AFTER trigger would read the
-- transaction's old snapshot. This is 0281's argument, for a phase in place of an entrant.
--
-- WHAT DOES NOT CHANGE. No data: a phase already on a Tournament stays, whatever its kind. No table,
-- no column, no rule, no grant on a table. 0281's and 0287's triggers stay as they are.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- Two new trigger functions, SECURITY INVOKER, closed to the web roles (execute revoked from
-- public, anon and authenticated, granted to service_role). No new table.

create or replace function public.entrant_kind_set_before_phases()
returns trigger
language plpgsql
volatile
security invoker
set search_path = public, pg_catalog
as $$
begin
  if exists (select 1 from public.phases p where p.tournament_id = new.id) then
    raise exception 'entrant_kind_set_before_phases: Tournament % has a phase, so its kind stays %',
      new.id, old.entrant_kind
      using errcode = 'check_violation', constraint = 'entrant_kind_set_before_phases',
            table = tg_table_name, schema = tg_table_schema;
  end if;
  return null;
end;
$$;

comment on function public.entrant_kind_set_before_phases() is
  'Refuses a change of a Tournament''s kind once it has a phase (0288, ruling 989).';

revoke execute on function public.entrant_kind_set_before_phases() from public, anon, authenticated;
grant execute on function public.entrant_kind_set_before_phases() to service_role;

create or replace function public.phase_locks_entrant_kind()
returns trigger
language plpgsql
volatile
security invoker
set search_path = public, pg_catalog
as $$
begin
  -- Only the owner and service_role write this table (0247), so "not found" means no row: the
  -- foreign key refuses it (23503).
  perform 1
     from public.tournaments t
    where t.id = new.tournament_id
      for share;
  return new;
end;
$$;

comment on function public.phase_locks_entrant_kind() is
  'Holds a new phase''s Tournament FOR SHARE, so a change of its kind waits and then sees the phase (0288).';

revoke execute on function public.phase_locks_entrant_kind() from public, anon, authenticated;
grant execute on function public.phase_locks_entrant_kind() to service_role;

drop trigger if exists entrant_kind_set_before_phases on public.tournaments;
create trigger entrant_kind_set_before_phases
  after update of entrant_kind on public.tournaments
  for each row
  when (old.entrant_kind is distinct from new.entrant_kind)
  execute function public.entrant_kind_set_before_phases();

drop trigger if exists phase_locks_entrant_kind on public.phases;
create trigger phase_locks_entrant_kind
  before insert or update of tournament_id on public.phases
  for each row
  execute function public.phase_locks_entrant_kind();

-- Prove it landed, from the catalog only (it also runs on production: no row is written). Each
-- trigger once, on its table; both functions VOLATILE and closed to the web roles.
do $$
declare
  missing text;
begin
  select string_agg(r.tbl || '.' || r.name, ', ') into missing
    from (values
      ('tournaments', 'entrant_kind_set_before_phases'),
      ('phases', 'phase_locks_entrant_kind')
    ) as r(tbl, name)
   where (select count(*) from pg_trigger t
           where t.tgrelid = ('public.' || r.tbl)::regclass and t.tgname = r.name
             and not t.tgisinternal) <> 1;
  if missing is not null then
    raise exception '0288: a trigger is missing: %', missing;
  end if;

  select string_agg(r.name, ', ') into missing
    from (values ('entrant_kind_set_before_phases'), ('phase_locks_entrant_kind')) as r(name)
   where not exists (select 1 from pg_proc p
                      where p.pronamespace = 'public'::regnamespace and p.proname = r.name
                        and p.provolatile = 'v'
                        and not has_function_privilege('anon', p.oid, 'execute')
                        and not has_function_privilege('authenticated', p.oid, 'execute'));
  if missing is not null then
    raise exception '0288: these functions are not VOLATILE or are open to a web role: %', missing;
  end if;
end
$$;

notify pgrst, 'reload schema';
