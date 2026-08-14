-- 0188_search_public_fighters.sql
-- Fuzzy, paginated, club-aware search over the public fighter directory.
--
-- ── Why not lookup_global_persons ─────────────────────────────────────────────
--
-- 0114's function is the nearest thing and is unusable here for three reasons,
-- none of which can be patched without changing its signature (which would break
-- its existing caller):
--
--   1. It matches NAMES ONLY. A reader who types a club name -- "garde noire" --
--      gets nothing, even though every fighter in that club is in the directory.
--      One box that finds a person OR their club is the whole point of the
--      search; two boxes for one intention is not.
--   2. It takes p_limit with NO OFFSET, so it cannot paginate. Page 2 of a fuzzy
--      search is simply not expressible.
--   3. It knows nothing about the directory predicate (0187), so it would return
--      unlisted and unclaimed people to a public surface.
--
-- ── The predicate is BAKED IN, not left to the caller ─────────────────────────
--
-- A caller that forgets it publishes people who opted out. This function is the
-- only way into the directory, so the rule lives where it cannot be skipped, and
-- it is the same rule as isListed() in directory-predicate.ts and as the RLS
-- policy in 0187.
--
-- ── p_sort is CASE-matched, never interpolated ────────────────────────────────
--
-- Hard rule 5 in spirit: no string a caller supplies is ever compiled. An
-- unrecognised value falls back to name order rather than erroring, so a
-- link-rotted ?sort= degrades instead of 500ing a public page.
--
-- ── total via COUNT(*) OVER () ────────────────────────────────────────────────
--
-- The pager needs a real total, and a second round trip to count would be a
-- second scan of the same predicate. The window function computes it over the
-- filtered set before LIMIT/OFFSET apply.
--
-- ── Security posture ──────────────────────────────────────────────────────────
--
-- SECURITY INVOKER (the default) so the function cannot become a way around the
-- RLS 0187 just tightened. The API calls it as service_role, which is BYPASSRLS,
-- so invoker costs nothing here and closes that door permanently.
--
-- The three grant statements are all required. Per 0184's header: REVOKE FROM
-- PUBLIC removes only the catch-all grant, while the Supabase image's ALTER
-- DEFAULT PRIVILEGES grants EXECUTE to anon and authenticated BY NAME, and a
-- role-specific grant survives a revoke aimed at PUBLIC. The roles have to be
-- named to be revoked.

-- ── 1. Index the similarity legs that were never covered ─────────────────────
--
-- global_persons_name_trgm_idx (0025) covers ONLY
-- immutable_unaccent(given_name || ' ' || family_name). lookup_global_persons
-- has always probed the reversed form and display_name as well, and both were
-- unindexed sequential scans. This function adds a club-name leg on top, so
-- without these the directory scans global_persons and clubs on every keystroke.

create index if not exists global_persons_name_reversed_trgm_idx
  on public.global_persons using gin (
    public.immutable_unaccent(family_name || ' ' || given_name) gin_trgm_ops
  );

create index if not exists global_persons_display_name_trgm_idx
  on public.global_persons using gin (
    public.immutable_unaccent(display_name) gin_trgm_ops
  );

create index if not exists clubs_name_trgm_idx
  on public.clubs using gin (public.immutable_unaccent(name) gin_trgm_ops);

-- ── 2. The search function ───────────────────────────────────────────────────

create or replace function public.search_public_fighters(
  p_query     text default null,
  p_country   text default null,
  p_weapon    text default null,
  p_sort      text default 'name',
  p_dir       text default 'asc',
  p_limit     int default 24,
  p_offset    int default 0,
  p_threshold float default 0.2,
  -- The sitemap enumerates only fighters who opted into indexing. Filtering
  -- here rather than in the caller keeps `total` and the paging honest, and
  -- keeps the indexing rule in the same place as the listing rule.
  p_indexable_only boolean default false
)
returns table (
  id         uuid,
  similarity float,
  total      bigint
)
language sql
stable
set search_path = public, pg_catalog
as $$
  with matched as (
    select
      gp.id,
      gp.family_name,
      gp.given_name,
      c.name as club_name,
      gp.country_code,
      case
        when p_query is null or btrim(p_query) = '' then 1.0::float
        else greatest(
          similarity(
            public.immutable_unaccent(gp.given_name || ' ' || gp.family_name),
            public.immutable_unaccent(p_query)
          ),
          similarity(
            public.immutable_unaccent(gp.family_name || ' ' || gp.given_name),
            public.immutable_unaccent(p_query)
          ),
          similarity(
            public.immutable_unaccent(coalesce(gp.display_name, '')),
            public.immutable_unaccent(p_query)
          ),
          -- The leg lookup_global_persons does not have: "garde noire" finds
          -- that club's fighters from the same box that finds "kuntz".
          similarity(
            public.immutable_unaccent(coalesce(c.name, '')),
            public.immutable_unaccent(p_query)
          )
        )
      end as score
    from public.global_persons gp
    left join public.clubs c on c.id = gp.club_id
    where
      -- The directory predicate, identical to isListed() and to 0187's policy.
      gp.listed_in_directory
      and gp.claimed_by_user_id is not null
      and gp.is_fighter
      and gp.deleted_at is null
      and gp.merged_into_id is null
      and gp.account_deleted_at is null
      and (not p_indexable_only or gp.search_indexable)
      and (p_country is null or btrim(p_country) = '' or gp.country_code = upper(p_country))
      and (
        p_weapon is null or btrim(p_weapon) = ''
        or exists (
          select 1
          from public.fighter_weapons fw
          join public.weapon_catalog wc on wc.id = fw.weapon_id
          where fw.global_person_id = gp.id
            and wc.slug = p_weapon
        )
      )
  ),
  scored as (
    select *
    from matched
    where p_query is null or btrim(p_query) = '' or score >= p_threshold
  )
  select
    s.id,
    s.score as similarity,
    count(*) over () as total
  from scored s
  order by
    -- Relevance first whenever the reader actually typed something: a fuzzy
    -- match ordered alphabetically buries the row they meant.
    case when p_query is null or btrim(p_query) = '' then 0 else 1 end * s.score desc,
    case when p_sort = 'club'    and p_dir <> 'desc' then s.club_name   end asc  nulls last,
    case when p_sort = 'club'    and p_dir =  'desc' then s.club_name   end desc nulls last,
    case when p_sort = 'country' and p_dir <> 'desc' then s.country_code end asc  nulls last,
    case when p_sort = 'country' and p_dir =  'desc' then s.country_code end desc nulls last,
    case when p_sort not in ('club', 'country') and p_dir =  'desc' then s.family_name end desc,
    case when p_sort not in ('club', 'country') and p_dir <> 'desc' then s.family_name end asc,
    s.given_name asc,
    -- Total order. Without a unique tiebreak, two rows equal on every sort key
    -- can swap between pages and the reader sees one twice and another never.
    s.id asc
  limit greatest(1, least(coalesce(p_limit, 24), 50))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.search_public_fighters(
  text, text, text, text, text, int, int, float, boolean
) from public;

-- Named explicitly: the image grants EXECUTE to these two by name, and a
-- role-specific grant survives a revoke aimed at PUBLIC (see 0184).
revoke execute on function public.search_public_fighters(
  text, text, text, text, text, int, int, float, boolean
) from anon, authenticated;

grant execute on function public.search_public_fighters(
  text, text, text, text, text, int, int, float, boolean
) to service_role;

NOTIFY pgrst, 'reload schema';
