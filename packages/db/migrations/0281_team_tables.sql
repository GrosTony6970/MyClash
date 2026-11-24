-- 0281: a Tournament has a kind; teams and their slots (team Tournaments, slice 1a; ADR-022).
--
-- A Tournament is fought either by Fighters, one Registration per side of a Match, or by teams,
-- one Team per side. Its kind says which, and it holds only entrants of that kind. A team is a
-- name and a number of seats; a slot is one place on it: a numbered seat, or a reserve with no
-- number, each naming a Person of the Event or, for a seat, nobody yet.
--
-- WHAT CHANGES.
--   1. `tournaments.entrant_kind` ('individual', the default, or 'team') and
--      `tournaments.team_default_size`, the size a new team of the Tournament starts with (1 to 10,
--      or none). The limit of 10 is the operator's (2026-11-24).
--   2. `teams`: a Tournament's team, its name and slug unique in the Tournament, its size (1 to
--      10) counting its numbered seats. No logo column yet: it comes with the upload route of
--      slice 1b, as the archive's `_url` guard wants.
--   3. `team_slots`: a seat (`position`) or a reserve (no position, so a Person), at most one live
--      slot per position, one live team per Person in a Tournament and one live captain per team;
--      a captain is a named slot. The Tournament is repeated on the slot and held to its team's by
--      the composite key, so the "one team per Person" index can name it. `person_id` is checked
--      at commit (NO ACTION DEFERRABLE INITIALLY DEFERRED): a Person and a slot both die by cascade
--      from one Event, the case 0237 rules on. A slot's number is checked against its team's size
--      by the API (slice 1b), not here.
--   4. Read rule: the public reads a team and its slots when the Tournament and its Event are both
--      public, in the shape of `match_protests_select` (0276). No club-member or super-admin
--      branch: since 0273 a signed-in reader reads through the API only, so that branch can open
--      for no one (0274's rule), and the rule calls no helper (0275: none to grant). The subquery
--      reads `tournaments` and `events` under the reader's own rules, which already hide a draft,
--      so the two status clauses are defence in depth, as in 0276.
--   5. No write rule and no write grant: only the API writes them (0247: a new table starts closed
--      to web writes).
--   6. The kind trigger. `entrant_kind_holds()`, BEFORE INSERT OR UPDATE OF tournament_id on
--      `registrations` and `teams`, refuses a Registration in a team Tournament and a Team in an
--      individual one. With no Tournament found it lets the row on, and the foreign key refuses it
--      with its own error (23503). Under RLS "not found" would also mean "not visible", but no web
--      role writes these tables: only the owner and `service_role` reach the trigger, and for them
--      "not found" means no row. `entrant_kind_is_settled()`, AFTER UPDATE OF entrant_kind on
--      `tournaments` when the kind really changes, refuses the change once a Registration or a
--      Team of the Tournament exists. Without that WHEN, a save that sends the same kind again
--      would be refused on every Tournament with entrants. Both refuse with SQLSTATE 23514 and
--      the name of the rule as the constraint, so a caller can tell them apart.
--
-- THE RACE. An entrant and a change of kind can arrive at once. The entrant reads the kind with
-- FOR SHARE: a running change of kind holds the row, so the entrant waits for it and then reads the
-- kind of after it. The change is checked AFTER its own row lock, by a VOLATILE function, so its
-- query takes a new snapshot and sees an entrant committed meanwhile; an entrant still running
-- holds its FOR SHARE, so the change waits for it first. A BEFORE UPDATE check would read before
-- the lock and miss that entrant. The FOR SHARE could deadlock two transactions that each add a
-- Registration and then update its Tournament; no path does both in one transaction (the API
-- writes one statement per request, and no database function inserts a Registration). The argument
-- assumes READ COMMITTED, which the API and PostgREST use: under REPEATABLE READ the AFTER trigger
-- would read the transaction's old snapshot.
--
-- WHAT DOES NOT CHANGE. Every existing Tournament is 'individual', which is what it holds. No
-- existing rule or grant. A Tournament delete takes its teams and their slots by cascade.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- Two new tables, RLS on, one read rule each for anon on public Tournaments, no write for any web
-- role. Two new trigger functions, SECURITY INVOKER, closed to the web roles.

set constraints all immediate;

alter table public.tournaments
  add column if not exists entrant_kind text not null default 'individual',
  add column if not exists team_default_size integer;
alter table public.tournaments
  add constraint tournaments_entrant_kind_known
    check (case when entrant_kind in ('individual', 'team') then true else false end),
  add constraint tournaments_team_default_size_range
    check (case when team_default_size is null then true
                when team_default_size between 1 and 10 then true else false end);

create table if not exists public.teams (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  name          text not null,
  slug          text not null,
  size          integer not null,
  seed          integer,
  color         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint teams_id_tournament_key unique (id, tournament_id),
  constraint teams_size_range check (case when size between 1 and 10 then true else false end),
  constraint teams_name_filled
    check (case when length(btrim(name)) between 1 and 120 then true else false end),
  constraint teams_slug_shape check (case when slug ~ '^[a-z0-9-]{2,100}$' then true else false end)
);
create unique index if not exists teams_tournament_name_key on public.teams (tournament_id, lower(name));
create unique index if not exists teams_tournament_slug_key on public.teams (tournament_id, slug);

create table if not exists public.team_slots (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null,
  tournament_id uuid not null,
  position      integer,
  person_id     uuid references public.persons (id) deferrable initially deferred,
  is_captain    boolean not null default false,
  retired_at    timestamptz,
  created_at    timestamptz not null default now(),
  constraint team_slots_team_fkey foreign key (team_id, tournament_id)
    references public.teams (id, tournament_id) on delete cascade,
  constraint team_slots_position_positive
    check (case when position is null then true when position >= 1 then true else false end),
  constraint team_slots_seat_or_reserve check (position is not null or person_id is not null),
  constraint team_slots_captain_is_named check (not is_captain or person_id is not null)
);
create unique index if not exists team_slots_one_per_position
  on public.team_slots (team_id, position) where position is not null and retired_at is null;
create unique index if not exists team_slots_one_team_per_person
  on public.team_slots (tournament_id, person_id) where person_id is not null and retired_at is null;
create unique index if not exists team_slots_one_captain
  on public.team_slots (team_id) where is_captain and retired_at is null;
create index if not exists team_slots_person_idx
  on public.team_slots (person_id) where person_id is not null;

alter table public.teams enable row level security;
alter table public.team_slots enable row level security;

drop policy if exists "teams_select" on public.teams;
create policy "teams_select" on public.teams for select
  using (
    exists (
      select 1
      from public.tournaments t
      join public.events e on e.id = t.event_id
      where t.id = teams.tournament_id
        and e.status in ('published','running','completed')
        and t.status in ('published','running','completed')
    )
  );

drop policy if exists "team_slots_select" on public.team_slots;
create policy "team_slots_select" on public.team_slots for select
  using (
    exists (
      select 1
      from public.tournaments t
      join public.events e on e.id = t.event_id
      where t.id = team_slots.tournament_id
        and e.status in ('published','running','completed')
        and t.status in ('published','running','completed')
    )
  );

-- The kind the row's table holds is the trigger's argument: 'individual' on `registrations`,
-- 'team' on `teams`.
create or replace function public.entrant_kind_holds()
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
  -- Only the owner and service_role write these tables, so "not found" means no row: the foreign
  -- key refuses it (23503).
  if not found then
    return new;
  end if;
  if v_kind <> tg_argv[0] then
    raise exception 'entrant_kind_holds: a % Tournament holds no % row', v_kind, tg_table_name
      using errcode = 'check_violation', constraint = 'entrant_kind_holds',
            table = tg_table_name, schema = tg_table_schema;
  end if;
  return new;
end;
$$;

comment on function public.entrant_kind_holds() is
  'Refuses a Registration in a team Tournament and a Team in an individual one (0281).';

revoke execute on function public.entrant_kind_holds() from public, anon, authenticated;
grant execute on function public.entrant_kind_holds() to service_role;

create or replace function public.entrant_kind_is_settled()
returns trigger
language plpgsql
volatile
security invoker
set search_path = public, pg_catalog
as $$
begin
  if exists (select 1 from public.registrations r where r.tournament_id = new.id)
     or exists (select 1 from public.teams tm where tm.tournament_id = new.id) then
    raise exception 'entrant_kind_is_settled: Tournament % has entrants, so its kind stays %',
      new.id, old.entrant_kind
      using errcode = 'check_violation', constraint = 'entrant_kind_is_settled',
            table = tg_table_name, schema = tg_table_schema;
  end if;
  return null;
end;
$$;

comment on function public.entrant_kind_is_settled() is
  'Refuses a change of a Tournament''s kind once it holds a Registration or a Team (0281).';

revoke execute on function public.entrant_kind_is_settled() from public, anon, authenticated;
grant execute on function public.entrant_kind_is_settled() to service_role;

drop trigger if exists entrant_kind_holds on public.registrations;
create trigger entrant_kind_holds
  before insert or update of tournament_id on public.registrations
  for each row
  execute function public.entrant_kind_holds('individual');

drop trigger if exists entrant_kind_holds on public.teams;
create trigger entrant_kind_holds
  before insert or update of tournament_id on public.teams
  for each row
  execute function public.entrant_kind_holds('team');

drop trigger if exists entrant_kind_is_settled on public.tournaments;
create trigger entrant_kind_is_settled
  after update of entrant_kind on public.tournaments
  for each row
  when (old.entrant_kind is distinct from new.entrant_kind)
  execute function public.entrant_kind_is_settled();

-- Prove it landed, from the catalog only (it also runs on production: no row is written). RLS on
-- both tables, one read rule each that reads the public statuses and no signed-in branch; every
-- named constraint, unique index and trigger once, on its table; both functions VOLATILE.
do $$
declare
  missing text;
begin
  select string_agg(r.tbl, ', ') into missing
    from (values ('teams'), ('team_slots')) as r(tbl)
   where not exists (select 1 from pg_class c
                      where c.oid = ('public.' || r.tbl)::regclass and c.relrowsecurity);
  if missing is not null then
    raise exception '0281: RLS is off on %', missing;
  end if;

  select string_agg(r.tbl, ', ') into missing
    from (values ('teams'), ('team_slots')) as r(tbl)
   where (select count(*) from pg_policies p
           where p.schemaname = 'public' and p.tablename = r.tbl) <> 1
      or not exists (select 1 from pg_policies p
                      where p.schemaname = 'public' and p.tablename = r.tbl
                        and p.cmd = 'SELECT'
                        and p.qual like '%''published''%'
                        and p.qual not like '%is_org_member%'
                        and p.qual not like '%is_super_admin%');
  if missing is not null then
    raise exception '0281: these tables lack their one public read rule: %', missing;
  end if;

  select string_agg(r.tbl || '.' || r.name, ', ') into missing
    from (values
      ('tournaments', 'tournaments_entrant_kind_known'),
      ('tournaments', 'tournaments_team_default_size_range'),
      ('teams', 'teams_id_tournament_key'),
      ('teams', 'teams_size_range'),
      ('teams', 'teams_name_filled'),
      ('teams', 'teams_slug_shape'),
      ('team_slots', 'team_slots_team_fkey'),
      ('team_slots', 'team_slots_position_positive'),
      ('team_slots', 'team_slots_seat_or_reserve'),
      ('team_slots', 'team_slots_captain_is_named')
    ) as r(tbl, name)
   where (select count(*) from pg_constraint c
           where c.conrelid = ('public.' || r.tbl)::regclass and c.conname = r.name) <> 1;
  if missing is not null then
    raise exception '0281: a constraint is missing: %', missing;
  end if;

  select string_agg(r.tbl || '.' || r.name, ', ') into missing
    from (values
      ('teams', 'teams_tournament_name_key'),
      ('teams', 'teams_tournament_slug_key'),
      ('team_slots', 'team_slots_one_per_position'),
      ('team_slots', 'team_slots_one_team_per_person'),
      ('team_slots', 'team_slots_one_captain')
    ) as r(tbl, name)
   where (select count(*) from pg_index i
            join pg_class ic on ic.oid = i.indexrelid
           where i.indrelid = ('public.' || r.tbl)::regclass and ic.relname = r.name
             and i.indisunique) <> 1;
  if missing is not null then
    raise exception '0281: a unique index is missing: %', missing;
  end if;

  select string_agg(r.tbl || '.' || r.name, ', ') into missing
    from (values
      ('registrations', 'entrant_kind_holds'),
      ('teams', 'entrant_kind_holds'),
      ('tournaments', 'entrant_kind_is_settled')
    ) as r(tbl, name)
   where (select count(*) from pg_trigger t
           where t.tgrelid = ('public.' || r.tbl)::regclass and t.tgname = r.name
             and not t.tgisinternal) <> 1;
  if missing is not null then
    raise exception '0281: a trigger is missing: %', missing;
  end if;

  select string_agg(r.name, ', ') into missing
    from (values ('entrant_kind_holds'), ('entrant_kind_is_settled')) as r(name)
   where not exists (select 1 from pg_proc p
                      where p.pronamespace = 'public'::regnamespace and p.proname = r.name
                        and p.provolatile = 'v');
  if missing is not null then
    raise exception '0281: these functions are not VOLATILE: %', missing;
  end if;
end
$$;

notify pgrst, 'reload schema';
