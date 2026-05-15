-- ============================================================
-- MyClash — Import refinements
-- Migration: 0025_import_refinements.sql
-- Changes:
--   1. persons.email nullable (partial unique index)
--   2. clubs.abbreviation column with case-insensitive unique index
-- ============================================================

-- ── 1. Make persons.email nullable ───────────────────────────────────────────

ALTER TABLE persons ALTER COLUMN email DROP NOT NULL;

-- Drop old UNIQUE(event_id, lower(email)) index (created inline in 0001_init)
DO $$
DECLARE
  idx_name TEXT;
BEGIN
  SELECT i.relname INTO idx_name
  FROM pg_index x
  JOIN pg_class i ON i.oid = x.indexrelid
  JOIN pg_class t ON t.oid = x.indrelid
  WHERE t.relname = 'persons'
    AND x.indisunique = true
    AND pg_get_indexdef(x.indexrelid) LIKE '%lower(email)%';

  IF idx_name IS NOT NULL THEN
    EXECUTE format('DROP INDEX IF EXISTS %I', idx_name);
  END IF;
END $$;

-- Partial unique index: only enforce email uniqueness when email is present
CREATE UNIQUE INDEX IF NOT EXISTS persons_event_id_email_key
  ON persons (event_id, lower(email))
  WHERE email IS NOT NULL;

-- ── 2. Club abbreviation ──────────────────────────────────────────────────────

ALTER TABLE clubs ADD COLUMN IF NOT EXISTS abbreviation TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS clubs_abbreviation_lower_idx
  ON clubs (lower(abbreviation))
  WHERE abbreviation IS NOT NULL;

-- ── 3. pg_trgm index for global_persons name lookup (used by import preview) ─

CREATE INDEX IF NOT EXISTS global_persons_name_trgm_idx
  ON global_persons USING GIN (
    public.immutable_unaccent(given_name || ' ' || family_name) gin_trgm_ops
  );

-- ============================================================
-- End of 0025_import_refinements.sql
-- ============================================================
