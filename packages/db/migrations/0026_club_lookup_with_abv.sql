-- ============================================================
-- MyClash — Updated find_club_by_name RPC
-- Migration: 0026_club_lookup_with_abv.sql
-- Dep: 0025_import_refinements.sql (clubs.abbreviation column)
--
-- Lookup priority:
--   1. Exact case-insensitive abbreviation match  → confidence 'exact_abv'
--   2. Name trigram similarity ≥ 0.85             → confidence 'high'
--   3. Name trigram similarity 0.40–0.85           → confidence 'medium'
-- ============================================================

DROP FUNCTION IF EXISTS find_club_by_name(TEXT, FLOAT);

CREATE OR REPLACE FUNCTION find_club_by_name(
  search_name TEXT,
  threshold   FLOAT DEFAULT 0.4
)
RETURNS TABLE (
  id           UUID,
  name         TEXT,
  abbreviation TEXT,
  city         TEXT,
  match_score  FLOAT,
  confidence   TEXT
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH abv_matches AS (
    SELECT
      c.id,
      c.name,
      c.abbreviation,
      c.city,
      1.0::FLOAT        AS match_score,
      'exact_abv'::TEXT AS confidence
    FROM clubs c
    WHERE c.abbreviation IS NOT NULL
      AND lower(c.abbreviation) = lower(search_name)
  ),
  name_matches AS (
    SELECT
      c.id,
      c.name,
      c.abbreviation,
      c.city,
      similarity(public.immutable_unaccent(c.name), public.immutable_unaccent(search_name))::FLOAT AS match_score,
      CASE
        WHEN similarity(public.immutable_unaccent(c.name), public.immutable_unaccent(search_name)) >= 0.85
          THEN 'high'
        ELSE 'medium'
      END::TEXT AS confidence
    FROM clubs c
    WHERE similarity(public.immutable_unaccent(c.name), public.immutable_unaccent(search_name)) >= threshold
      AND NOT EXISTS (SELECT 1 FROM abv_matches WHERE abv_matches.id = c.id)
  )
  SELECT * FROM abv_matches
  UNION ALL
  SELECT * FROM name_matches
  ORDER BY match_score DESC
  LIMIT 5;
END;
$$;

-- ============================================================
-- End of 0026_club_lookup_with_abv.sql
-- ============================================================
