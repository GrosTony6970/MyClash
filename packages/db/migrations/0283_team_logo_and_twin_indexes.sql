-- 0283: a team's logo, and an index on each key that names a team (team Tournaments, slice 1b-1;
-- ADR-022).
--
-- In slice 1b-1 an organiser gives a team a logo and can delete a team. A delete of a team reads
-- every table whose key names that team: to take its rows (cascade), to clear the key (set null),
-- or to refuse the delete at commit (0237). Without an index, each of those reads scans the whole
-- table.
--
-- WHAT CHANGES.
--   1. `teams.logo_url`: the link to the team's logo, or none. The upload route of slice 1b-1
--      stores the file in the public `event-assets` bucket, as a Tournament's logo is stored. The
--      archive lists the column (`ARCHIVE_IMAGE_COLUMNS`, `archive-images.ts`): an archive of a
--      whole Event carries the file, an archive of one Tournament keeps the link (ruling 975;
--      ruling 407 stands). The archive's guard refuses a `_url` column that list does not name
--      (`archive.migration-coverage.test.ts`), so the column and its line land together.
--   2. One index on each of the ten team keys of 0282, named `<table>_<column>_idx` as in 0080:
--        pool_members.team_id                       cascade
--        bracket_slots.team_a_id, team_b_id         set null
--        matches.red_team_id, blue_team_id          checked at commit
--        matches.winner_team_id                     set null
--        match_penalties.team_id                    cascade
--        match_forfeits.forfeiting_team_id,
--          winner_team_id                           checked at commit
--        match_protests.team_id                     cascade
--      Each is partial (`where <column> is not null`), as 0080's sparse keys: a row of an
--      individual Tournament names no team. A key's lookup compares the column with `=`, which is
--      never true on a null, so the planner proves the predicate and uses the partial index.
--      0282 left these to "the first reader"; the delete of a team is that reader.
--   3. `team_slots_team_id_tournament_id_idx` on `team_slots (team_id, tournament_id)`: the key
--      `team_slots_team_fkey` (0281) takes a team's slots by cascade, and no index led with
--      `team_id` on every row (the three of 0281 are partial).
--   The DO block then reads the column and each index back by its exact definition.
--
-- WHAT DOES NOT CHANGE. No rule, grant, function, trigger or check. No row is written. A team
-- of 0281 has no logo: the column starts empty on every row.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table, rule, function or grant. `teams_select` (0281) reads a team row whole, so the
-- public reads a team's logo link exactly when it reads the team: its Tournament and its Event are
-- both public. A Tournament's logo link is public on the same terms. No web role writes `teams`
-- (0247).

-- A guard: this migration writes no row, so no deferred check is pending. Keys that name a team
-- are DEFERRED (0282), and an ALTER behind a pending check would fail 55006.
set constraints all immediate;

alter table public.teams
  add column if not exists logo_url text;

create index if not exists pool_members_team_id_idx
  on public.pool_members (team_id) where team_id is not null;
create index if not exists bracket_slots_team_a_id_idx
  on public.bracket_slots (team_a_id) where team_a_id is not null;
create index if not exists bracket_slots_team_b_id_idx
  on public.bracket_slots (team_b_id) where team_b_id is not null;
create index if not exists matches_red_team_id_idx
  on public.matches (red_team_id) where red_team_id is not null;
create index if not exists matches_blue_team_id_idx
  on public.matches (blue_team_id) where blue_team_id is not null;
create index if not exists matches_winner_team_id_idx
  on public.matches (winner_team_id) where winner_team_id is not null;
create index if not exists match_penalties_team_id_idx
  on public.match_penalties (team_id) where team_id is not null;
create index if not exists match_forfeits_forfeiting_team_id_idx
  on public.match_forfeits (forfeiting_team_id) where forfeiting_team_id is not null;
create index if not exists match_forfeits_winner_team_id_idx
  on public.match_forfeits (winner_team_id) where winner_team_id is not null;
create index if not exists match_protests_team_id_idx
  on public.match_protests (team_id) where team_id is not null;
create index if not exists team_slots_team_id_tournament_id_idx
  on public.team_slots (team_id, tournament_id);

-- Prove it landed, from the catalog only (it also runs on production: no row is written). The
-- column nullable text; each index once on its table, with its exact text: a name alone passes an
-- index on the wrong column.
do $$
declare
  wrong text;
begin
  if not exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public' and c.table_name = 'teams'
                    and c.column_name = 'logo_url' and c.data_type = 'text'
                    and c.is_nullable = 'YES') then
    raise exception '0283: teams.logo_url is missing or not a nullable text';
  end if;

  select string_agg(r.tbl || '.' || r.name || ' is ' || coalesce(
           (select string_agg(pg_get_indexdef(i.indexrelid), ' | ') from pg_index i
              join pg_class ic on ic.oid = i.indexrelid
             where i.indrelid = ('public.' || r.tbl)::regclass and ic.relname = r.name),
           'missing'), '; ') into wrong
    from (values
      ('pool_members', 'pool_members_team_id_idx', '(team_id) WHERE (team_id IS NOT NULL)'),
      ('bracket_slots', 'bracket_slots_team_a_id_idx',
       '(team_a_id) WHERE (team_a_id IS NOT NULL)'),
      ('bracket_slots', 'bracket_slots_team_b_id_idx',
       '(team_b_id) WHERE (team_b_id IS NOT NULL)'),
      ('matches', 'matches_red_team_id_idx', '(red_team_id) WHERE (red_team_id IS NOT NULL)'),
      ('matches', 'matches_blue_team_id_idx', '(blue_team_id) WHERE (blue_team_id IS NOT NULL)'),
      ('matches', 'matches_winner_team_id_idx',
       '(winner_team_id) WHERE (winner_team_id IS NOT NULL)'),
      ('match_penalties', 'match_penalties_team_id_idx', '(team_id) WHERE (team_id IS NOT NULL)'),
      ('match_forfeits', 'match_forfeits_forfeiting_team_id_idx',
       '(forfeiting_team_id) WHERE (forfeiting_team_id IS NOT NULL)'),
      ('match_forfeits', 'match_forfeits_winner_team_id_idx',
       '(winner_team_id) WHERE (winner_team_id IS NOT NULL)'),
      ('match_protests', 'match_protests_team_id_idx', '(team_id) WHERE (team_id IS NOT NULL)'),
      ('team_slots', 'team_slots_team_id_tournament_id_idx', '(team_id, tournament_id)')
    ) as r(tbl, name, def)
   where (select count(*) from pg_index i
            join pg_class ic on ic.oid = i.indexrelid
           where i.indrelid = ('public.' || r.tbl)::regclass and ic.relname = r.name) <> 1
      or (select pg_get_indexdef(i.indexrelid) from pg_index i
            join pg_class ic on ic.oid = i.indexrelid
           where i.indrelid = ('public.' || r.tbl)::regclass and ic.relname = r.name)
         is distinct from
         'CREATE INDEX ' || r.name || ' ON public.' || r.tbl || ' USING btree ' || r.def;
  if wrong is not null then
    raise exception '0283: an index is not as written: %', wrong;
  end if;
end
$$;

notify pgrst, 'reload schema';
