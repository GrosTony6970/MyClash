-- 0282: a team twin beside each side link (team Tournaments, slice 1a; ADR-022).
--
-- A side of a Match is a Registration or a Team (0281). Every column that names a side by its
-- Registration gets a twin that names it by its Team, and a check says which of the two a row
-- holds.
--
-- WHAT CHANGES.
--   1. Ten columns, each `uuid references public.teams (id)`, with the delete action of its
--      Registration twin:
--        pool_members.team_id                 cascade
--        bracket_slots.team_a_id, team_b_id   set null
--        matches.red_team_id, blue_team_id    no action, checked at commit (0237)
--        matches.winner_team_id               set null
--        match_penalties.team_id              cascade
--        match_forfeits.forfeiting_team_id    no action, checked at commit (0237)
--        match_forfeits.winner_team_id        no action, checked at commit (0237)
--        match_protests.team_id               cascade (operator, 2026-11-24)
--      The four keys checked at commit have a child and a parent that both die by cascade from one
--      Tournament, the case 0237 rules on; the cascade probe lists them.
--   2. `registration_id` may be null on `pool_members`, `match_penalties` and `match_protests`, and
--      `forfeiting_registration_id` on `match_forfeits`: a team row names a Team there instead.
--   3. One check per side link:
--        exactly one of the pair: `pool_members_one_entrant`, `match_penalties_one_side`,
--          `match_protests_one_side`, `match_forfeits_forfeiting_one_kind`;
--        at most one of the pair: `bracket_slots_a_one_kind`, `bracket_slots_b_one_kind`,
--          `matches_red_one_kind`, `matches_blue_one_kind`, `matches_winner_one_kind`.
--      And three that keep a Match of one kind:
--        `matches_sides_same_kind`: never a Registration on one side and a Team on the other;
--        `matches_winner_same_kind`: a winner Team only on a Match with no Registration side, a
--          winner Registration only on a Match with no Team side;
--        `match_forfeits_same_kind`: a team forfeit never names a winner Registration, an
--          individual one never a winner Team.
--   4. `match_forfeits_draw_has_no_winner` (0239) read "no winner Registration" as "draw", so it
--      would refuse a team win. It is dropped BY NAME, no IF EXISTS (a missing constraint is a
--      broken history and must stop the replay, as in 0239), and comes back with the same name over
--      both winners: RLS probe check 15 still finds it.
--   5. `pool_members_pool_team_key`: a team once per Pool, as `pool_members_pool_id_registration_id_key`
--      holds a Registration once.
--   The DO block then reads every check and every new key back by its exact text.
--
-- WHY `match_forfeits.winner_team_id` HAS NO CHECK OF ITS OWN. `…_forfeiting_one_kind` says a
-- forfeit names one side that forfeits, and `…_same_kind` lets it name only a winner of that kind:
-- together they already allow at most one winner. Postgres tests a table's checks in name order and
-- reports the first that fails, and `match_forfeits_winner_one_kind` would sort after both: it could
-- never be the one that refuses a row.
--
-- WHAT DOES NOT CHANGE.
--   - `match_forfeits.replacement_registration_id` (0032, the reserve who took a Fighter's place)
--     gets no twin: a team's reserves are its slots, so a team forfeit never names one.
--   - No "a team of the same Tournament" trigger: nothing checks that for a Registration today
--     either, and a rule for one kind only is a second rule to keep in step.
--   - `match_protests` is in the `supabase_realtime` publication with REPLICA IDENTITY FULL (0276):
--     its new column rides along.
--   - No index on a new key yet: each comes with its first reader (slice 1b).
--   - Every row stored today names a Registration and no Team, so every new check holds on it. No
--     row is written.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table, rule, function or grant. The read rules of these tables find a row by its Match,
-- Pool or phase, never by its Registration, so they read a team row as they read any other. No
-- web role writes them (0238, 0247, 0276).

-- A guard: this migration writes no row, so no deferred check is pending. Keys of these tables are
-- DEFERRED (0237), and an ALTER behind a pending check would fail 55006 if a row were written above.
set constraints all immediate;

alter table public.pool_members
  add column if not exists team_id uuid references public.teams (id) on delete cascade,
  alter column registration_id drop not null,
  add constraint pool_members_one_entrant check (num_nonnulls(registration_id, team_id) = 1);
create unique index if not exists pool_members_pool_team_key
  on public.pool_members (pool_id, team_id) where team_id is not null;

alter table public.bracket_slots
  add column if not exists team_a_id uuid references public.teams (id) on delete set null,
  add column if not exists team_b_id uuid references public.teams (id) on delete set null,
  add constraint bracket_slots_a_one_kind check (num_nonnulls(registration_a_id, team_a_id) <= 1),
  add constraint bracket_slots_b_one_kind check (num_nonnulls(registration_b_id, team_b_id) <= 1);

alter table public.matches
  add column if not exists red_team_id uuid references public.teams (id)
    deferrable initially deferred,
  add column if not exists blue_team_id uuid references public.teams (id)
    deferrable initially deferred,
  add column if not exists winner_team_id uuid references public.teams (id) on delete set null,
  add constraint matches_red_one_kind check (num_nonnulls(red_registration_id, red_team_id) <= 1),
  add constraint matches_blue_one_kind check (num_nonnulls(blue_registration_id, blue_team_id) <= 1),
  add constraint matches_winner_one_kind
    check (num_nonnulls(winner_registration_id, winner_team_id) <= 1),
  add constraint matches_sides_same_kind
    check ((red_registration_id is null or blue_team_id is null)
           and (red_team_id is null or blue_registration_id is null)),
  add constraint matches_winner_same_kind
    check ((winner_team_id is null or (red_registration_id is null and blue_registration_id is null))
           and (winner_registration_id is null or (red_team_id is null and blue_team_id is null)));

alter table public.match_penalties
  add column if not exists team_id uuid references public.teams (id) on delete cascade,
  alter column registration_id drop not null,
  add constraint match_penalties_one_side check (num_nonnulls(registration_id, team_id) = 1);

alter table public.match_forfeits drop constraint match_forfeits_draw_has_no_winner;
alter table public.match_forfeits
  add column if not exists forfeiting_team_id uuid references public.teams (id)
    deferrable initially deferred,
  add column if not exists winner_team_id uuid references public.teams (id)
    deferrable initially deferred,
  alter column forfeiting_registration_id drop not null,
  add constraint match_forfeits_forfeiting_one_kind
    check (num_nonnulls(forfeiting_registration_id, forfeiting_team_id) = 1),
  add constraint match_forfeits_same_kind
    check ((forfeiting_team_id is null or winner_registration_id is null)
           and (forfeiting_registration_id is null or winner_team_id is null)),
  add constraint match_forfeits_draw_has_no_winner
    check ((score_policy = 'draw') = (winner_registration_id is null and winner_team_id is null));

alter table public.match_protests
  add column if not exists team_id uuid references public.teams (id) on delete cascade,
  alter column registration_id drop not null,
  add constraint match_protests_one_side check (num_nonnulls(registration_id, team_id) = 1);

-- Prove it landed, from the catalog only (it also runs on production: no row is written). Each
-- check and each new key exactly once on its table, with its exact text: a name alone passes a
-- check written wrong. The unique index once, partial on the team. The four Registration columns
-- nullable.
do $$
declare
  wrong text;
begin
  select string_agg(r.tbl || '.' || r.name || ' is ' || coalesce(
           (select string_agg(pg_get_constraintdef(c.oid), ' | ') from pg_constraint c
             where c.conrelid = ('public.' || r.tbl)::regclass and c.conname = r.name),
           'missing'), '; ') into wrong
    from (values
      ('pool_members', 'pool_members_one_entrant',
       'CHECK ((num_nonnulls(registration_id, team_id) = 1))'),
      ('pool_members', 'pool_members_team_id_fkey',
       'FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE'),
      ('bracket_slots', 'bracket_slots_a_one_kind',
       'CHECK ((num_nonnulls(registration_a_id, team_a_id) <= 1))'),
      ('bracket_slots', 'bracket_slots_b_one_kind',
       'CHECK ((num_nonnulls(registration_b_id, team_b_id) <= 1))'),
      ('bracket_slots', 'bracket_slots_team_a_id_fkey',
       'FOREIGN KEY (team_a_id) REFERENCES teams(id) ON DELETE SET NULL'),
      ('bracket_slots', 'bracket_slots_team_b_id_fkey',
       'FOREIGN KEY (team_b_id) REFERENCES teams(id) ON DELETE SET NULL'),
      ('matches', 'matches_red_one_kind',
       'CHECK ((num_nonnulls(red_registration_id, red_team_id) <= 1))'),
      ('matches', 'matches_blue_one_kind',
       'CHECK ((num_nonnulls(blue_registration_id, blue_team_id) <= 1))'),
      ('matches', 'matches_winner_one_kind',
       'CHECK ((num_nonnulls(winner_registration_id, winner_team_id) <= 1))'),
      ('matches', 'matches_sides_same_kind',
       'CHECK ((((red_registration_id IS NULL) OR (blue_team_id IS NULL)) AND ((red_team_id IS NULL) OR (blue_registration_id IS NULL))))'),
      ('matches', 'matches_winner_same_kind',
       'CHECK ((((winner_team_id IS NULL) OR ((red_registration_id IS NULL) AND (blue_registration_id IS NULL))) AND ((winner_registration_id IS NULL) OR ((red_team_id IS NULL) AND (blue_team_id IS NULL)))))'),
      ('matches', 'matches_red_team_id_fkey',
       'FOREIGN KEY (red_team_id) REFERENCES teams(id) DEFERRABLE INITIALLY DEFERRED'),
      ('matches', 'matches_blue_team_id_fkey',
       'FOREIGN KEY (blue_team_id) REFERENCES teams(id) DEFERRABLE INITIALLY DEFERRED'),
      ('matches', 'matches_winner_team_id_fkey',
       'FOREIGN KEY (winner_team_id) REFERENCES teams(id) ON DELETE SET NULL'),
      ('match_penalties', 'match_penalties_one_side',
       'CHECK ((num_nonnulls(registration_id, team_id) = 1))'),
      ('match_penalties', 'match_penalties_team_id_fkey',
       'FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE'),
      ('match_forfeits', 'match_forfeits_forfeiting_one_kind',
       'CHECK ((num_nonnulls(forfeiting_registration_id, forfeiting_team_id) = 1))'),
      ('match_forfeits', 'match_forfeits_same_kind',
       'CHECK ((((forfeiting_team_id IS NULL) OR (winner_registration_id IS NULL)) AND ((forfeiting_registration_id IS NULL) OR (winner_team_id IS NULL))))'),
      ('match_forfeits', 'match_forfeits_draw_has_no_winner',
       'CHECK (((score_policy = ''draw''::text) = ((winner_registration_id IS NULL) AND (winner_team_id IS NULL))))'),
      ('match_forfeits', 'match_forfeits_forfeiting_team_id_fkey',
       'FOREIGN KEY (forfeiting_team_id) REFERENCES teams(id) DEFERRABLE INITIALLY DEFERRED'),
      ('match_forfeits', 'match_forfeits_winner_team_id_fkey',
       'FOREIGN KEY (winner_team_id) REFERENCES teams(id) DEFERRABLE INITIALLY DEFERRED'),
      ('match_protests', 'match_protests_one_side',
       'CHECK ((num_nonnulls(registration_id, team_id) = 1))'),
      ('match_protests', 'match_protests_team_id_fkey',
       'FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE')
    ) as r(tbl, name, def)
   where (select count(*) from pg_constraint c
           where c.conrelid = ('public.' || r.tbl)::regclass and c.conname = r.name) <> 1
      or (select pg_get_constraintdef(c.oid) from pg_constraint c
           where c.conrelid = ('public.' || r.tbl)::regclass and c.conname = r.name)
         is distinct from r.def;
  if wrong is not null then
    raise exception '0282: a constraint is not as written: %', wrong;
  end if;

  if (select count(*) from pg_index i
        join pg_class ic on ic.oid = i.indexrelid
       where i.indrelid = 'public.pool_members'::regclass
         and ic.relname = 'pool_members_pool_team_key'
         and i.indisunique
         and pg_get_indexdef(i.indexrelid)
             like '% ON public.pool_members USING btree (pool_id, team_id) WHERE (team_id IS NOT NULL)'
     ) <> 1 then
    raise exception '0282: pool_members_pool_team_key is missing or not as written';
  end if;

  select string_agg(r.tbl || '.' || r.col, ', ') into wrong
    from (values
      ('pool_members', 'registration_id'),
      ('match_penalties', 'registration_id'),
      ('match_forfeits', 'forfeiting_registration_id'),
      ('match_protests', 'registration_id')
    ) as r(tbl, col)
   where not exists (select 1 from information_schema.columns c
                      where c.table_schema = 'public' and c.table_name = r.tbl
                        and c.column_name = r.col and c.is_nullable = 'YES');
  if wrong is not null then
    raise exception '0282: these columns are not nullable: %', wrong;
  end if;
end
$$;

notify pgrst, 'reload schema';
