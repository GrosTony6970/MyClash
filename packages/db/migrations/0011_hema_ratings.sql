-- 0011_hema_ratings.sql
-- T-1101: HEMA Ratings sync — hema_ratings_snapshots table + search index

-- ── Snapshot table ────────────────────────────────────────────────────────────
-- Stores the full fighter index pulled from hemaratings.com.
-- One row per sync run; old rows are kept for audit / rollback.
-- The latest snapshot is identified by MAX(synced_at).

CREATE TABLE IF NOT EXISTS hema_ratings_snapshots (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  fighter_count INTEGER   NOT NULL DEFAULT 0,
  -- JSONB array of { id: number, name: string, club: string }
  -- id is the numeric ID from the hemaratings.com URL
  fighters    JSONB       NOT NULL DEFAULT '[]'::jsonb
);

-- Index for fast lookup of the latest snapshot
CREATE INDEX IF NOT EXISTS idx_hema_ratings_snapshots_synced_at
  ON hema_ratings_snapshots (synced_at DESC);

-- ── Full-text search index on fighter names ───────────────────────────────────
-- Allows fast fuzzy matching when organizer links a registration to a HEMA Ratings profile.
-- We index the fighters JSONB array using a GIN index on the text search vector.
-- For per-fighter search we use a generated column approach via a function index.

-- Function to extract a tsvector from the fighters JSONB array
CREATE OR REPLACE FUNCTION hema_ratings_fighters_tsv(fighters JSONB)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT to_tsvector('simple',
    coalesce(
      string_agg(
        coalesce(f->>'name', '') || ' ' || coalesce(f->>'club', ''),
        ' '
      ),
      ''
    )
  )
  FROM jsonb_array_elements(fighters) AS f
$$;

CREATE INDEX IF NOT EXISTS idx_hema_ratings_snapshots_fighters_fts
  ON hema_ratings_snapshots
  USING GIN (hema_ratings_fighters_tsv(fighters));

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Only service role can write; authenticated users can read (for the suggest UI).
ALTER TABLE hema_ratings_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON hema_ratings_snapshots
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated_read" ON hema_ratings_snapshots
  FOR SELECT
  TO authenticated
  USING (true);
