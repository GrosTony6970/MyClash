-- ============================================================
-- MyClash — Lookup helper functions
-- Migration: 0003_lookup_functions.sql
-- Dep: 0001_init.sql (pg_trgm indexes on persons)
-- ============================================================

-- ── Person fuzzy name lookup ──────────────────────────────────────────────────
-- Used by T-104b: GET /events/:id/persons/lookup?q=...
-- Returns up to 10 persons sorted by similarity desc, threshold 0.3.
-- Searches unaccented given_name + family_name combined.

CREATE OR REPLACE FUNCTION lookup_persons(
  p_event_id  UUID,
  p_query     TEXT,
  p_limit     INT DEFAULT 10,
  p_threshold FLOAT DEFAULT 0.3
)
RETURNS TABLE (
  id            UUID,
  given_name    TEXT,
  family_name   TEXT,
  club_label    TEXT,
  masked_email  TEXT,
  similarity    FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    p.id,
    p.given_name,
    p.family_name,
    c.name AS club_label,
    -- Mask email: first char + *** @ first domain char + *** . tld
    CASE
      WHEN p.email LIKE '%@%' THEN
        LEFT(p.email, 1) || '***@' ||
        LEFT(SPLIT_PART(SPLIT_PART(p.email, '@', 2), '.', 1), 1) || '***.' ||
        SPLIT_PART(p.email, '.', -1)
      ELSE '***@***.***'
    END AS masked_email,
    GREATEST(
      similarity(public.immutable_unaccent(p.given_name), public.immutable_unaccent(p_query)),
      similarity(public.immutable_unaccent(p.family_name), public.immutable_unaccent(p_query)),
      similarity(public.immutable_unaccent(p.given_name || ' ' || p.family_name), public.immutable_unaccent(p_query)),
      similarity(public.immutable_unaccent(p.family_name || ' ' || p.given_name), public.immutable_unaccent(p_query))
    ) AS similarity
  FROM persons p
  LEFT JOIN clubs c ON c.id = p.club_id
  WHERE
    p.event_id = p_event_id
    AND GREATEST(
      similarity(public.immutable_unaccent(p.given_name), public.immutable_unaccent(p_query)),
      similarity(public.immutable_unaccent(p.family_name), public.immutable_unaccent(p_query)),
      similarity(public.immutable_unaccent(p.given_name || ' ' || p.family_name), public.immutable_unaccent(p_query)),
      similarity(public.immutable_unaccent(p.family_name || ' ' || p.given_name), public.immutable_unaccent(p_query))
    ) >= p_threshold
  ORDER BY similarity DESC
  LIMIT p_limit;
$$;

-- ── Club fuzzy name lookup ────────────────────────────────────────────────────
-- Used by T-104 CSV import: resolves club name to existing club row.

CREATE OR REPLACE FUNCTION find_club_by_name(
  search_name TEXT,
  threshold   FLOAT DEFAULT 0.4
)
RETURNS TABLE (
  id         UUID,
  name       TEXT,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id,
    c.name,
    similarity(public.immutable_unaccent(c.name), public.immutable_unaccent(search_name)) AS similarity
  FROM clubs c
  WHERE similarity(public.immutable_unaccent(c.name), public.immutable_unaccent(search_name)) >= threshold
  ORDER BY similarity DESC
  LIMIT 5;
$$;

-- ============================================================
-- End of 0003_lookup_functions.sql
-- ============================================================
