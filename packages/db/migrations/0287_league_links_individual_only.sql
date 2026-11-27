-- 0287: a League takes individual Tournaments only (team Tournaments, slice 1c-1; rulings 729, 981).
--
-- League points belong to persons: a League ranks Fighters by their placements in its Tournaments.
-- A team Tournament places teams, not Fighters, so a League link to it would give the League
-- nothing, in silence. The operator's rulings: a team Tournament is refused a League link (729),
-- and a Tournament with a League link is refused the switch to team (981: "Remove the League link
-- first: League points belong to persons"). The database is the one judge, as it is for the kind
-- (0281); the API refuses first with a named 409, and maps these two refusals to the same names.
--
-- WHAT CHANGES.
--   1. `league_link_individual_only()`, BEFORE INSERT OR UPDATE OF status, tournament_id on
--      `league_tournament_links`, WHEN the link is live (status 'requested' or 'approved', the two
--      of 0015's four that count), refuses it when its Tournament is a team one. A link 'rejected'
--      or 'removed' is not live and is taken: it keeps the history of a link that once was. With
--      no Tournament found it lets the row on, and the foreign key refuses it with its own error
--      (23503). Under RLS "not found" would also mean "not visible", but no web role writes this
--      table (0216): only the owner and `service_role` reach the trigger, and for them "not found"
--      means no row.
--   2. `league_link_blocks_team()`, AFTER UPDATE OF entrant_kind on `tournaments`, WHEN the kind
--      really changes and becomes 'team', refuses the switch while the Tournament has a live
--      League link. A switch back to 'individual' and a save that sends the same kind again never
--      reach it. A Tournament with entrants is refused first by `entrant_kind_is_settled` (0281),
--      which fires before it by name.
--   Both refuse with SQLSTATE 23514 and the name of the rule as the constraint. Each message STARTS
--   with that name and a colon: PostgREST does not pass the constraint name on, so the API's
--   `entrantKindRefusal` (`apps/api/src/common/entrant-kind-refusal.ts`) matches the prefix.
--
-- THE RACE. A link and a switch to team can arrive at once. The link reads its Tournament's kind
-- FOR SHARE: a running switch holds the row FOR NO KEY UPDATE, which conflicts with FOR SHARE, so
-- the link waits for it and then reads the kind of after it. (The link's foreign key takes only FOR
-- KEY SHARE, which a switch does not block: without the FOR SHARE the two would pass each other.)
-- The switch is checked AFTER its own row lock, by a VOLATILE function, so its query takes a new
-- snapshot and sees a link committed meanwhile; a link still running holds its FOR SHARE, so the
-- switch waits for it first. A BEFORE UPDATE check would read before the lock and miss that link.
-- The FOR SHARE could deadlock two transactions that each write a link and then update its
-- Tournament; no path does both in one transaction (the API writes one statement per request, and
-- no database function writes a link). The argument assumes READ COMMITTED, which the API and
-- PostgREST use: under REPEATABLE READ the AFTER trigger would read the transaction's old snapshot.
-- This is 0281's argument, for a link in place of an entrant.
--
-- WHAT DOES NOT CHANGE. No data: no team Tournament is deployed yet, so no live link to one exists.
-- `league_tournament_links` keeps RLS on and no read rule (0274): no web role reads or writes it. No
-- table, no column, no rule, no grant on a table.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- Two new trigger functions, SECURITY INVOKER, closed to the web roles (execute revoked from
-- public, anon and authenticated, granted to service_role). No new table.

create or replace function public.league_link_individual_only()
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
  -- Only the owner and service_role write this table, so "not found" means no row: the foreign
  -- key refuses it (23503).
  if not found then
    return new;
  end if;
  if v_kind = 'team' then
    raise exception 'league_link_individual_only: a League takes individual Tournaments only, and Tournament % is a team one',
      new.tournament_id
      using errcode = 'check_violation', constraint = 'league_link_individual_only',
            table = tg_table_name, schema = tg_table_schema;
  end if;
  return new;
end;
$$;

comment on function public.league_link_individual_only() is
  'Refuses a live League link (requested or approved) to a team Tournament (0287).';

revoke execute on function public.league_link_individual_only() from public, anon, authenticated;
grant execute on function public.league_link_individual_only() to service_role;

create or replace function public.league_link_blocks_team()
returns trigger
language plpgsql
volatile
security invoker
set search_path = public, pg_catalog
as $$
begin
  if exists (select 1 from public.league_tournament_links l
              where l.tournament_id = new.id and l.status in ('requested', 'approved')) then
    raise exception 'league_link_blocks_team: Tournament % has a live League link, so it stays individual',
      new.id
      using errcode = 'check_violation', constraint = 'league_link_blocks_team',
            table = tg_table_name, schema = tg_table_schema;
  end if;
  return null;
end;
$$;

comment on function public.league_link_blocks_team() is
  'Refuses a Tournament''s switch to team while it has a live League link (0287).';

revoke execute on function public.league_link_blocks_team() from public, anon, authenticated;
grant execute on function public.league_link_blocks_team() to service_role;

drop trigger if exists league_link_individual_only on public.league_tournament_links;
create trigger league_link_individual_only
  before insert or update of status, tournament_id on public.league_tournament_links
  for each row
  when (new.status in ('requested', 'approved'))
  execute function public.league_link_individual_only();

drop trigger if exists league_link_blocks_team on public.tournaments;
create trigger league_link_blocks_team
  after update of entrant_kind on public.tournaments
  for each row
  when (old.entrant_kind is distinct from new.entrant_kind and new.entrant_kind = 'team')
  execute function public.league_link_blocks_team();

-- Prove it landed, from the catalog only (it also runs on production: no row is written). Each
-- trigger once, on its table; both functions VOLATILE and closed to the web roles; the links table
-- still has RLS on and no rule.
do $$
declare
  missing text;
begin
  select string_agg(r.tbl || '.' || r.name, ', ') into missing
    from (values
      ('league_tournament_links', 'league_link_individual_only'),
      ('tournaments', 'league_link_blocks_team')
    ) as r(tbl, name)
   where (select count(*) from pg_trigger t
           where t.tgrelid = ('public.' || r.tbl)::regclass and t.tgname = r.name
             and not t.tgisinternal) <> 1;
  if missing is not null then
    raise exception '0287: a trigger is missing: %', missing;
  end if;

  select string_agg(r.name, ', ') into missing
    from (values ('league_link_individual_only'), ('league_link_blocks_team')) as r(name)
   where not exists (select 1 from pg_proc p
                      where p.pronamespace = 'public'::regnamespace and p.proname = r.name
                        and p.provolatile = 'v'
                        and not has_function_privilege('anon', p.oid, 'execute')
                        and not has_function_privilege('authenticated', p.oid, 'execute'));
  if missing is not null then
    raise exception '0287: these functions are not VOLATILE or are open to a web role: %', missing;
  end if;

  if not (select c.relrowsecurity from pg_class c
           where c.oid = 'public.league_tournament_links'::regclass)
     or exists (select 1 from pg_policies p
                 where p.schemaname = 'public' and p.tablename = 'league_tournament_links') then
    raise exception '0287: league_tournament_links lost its RLS or gained a rule';
  end if;
end
$$;

notify pgrst, 'reload schema';
