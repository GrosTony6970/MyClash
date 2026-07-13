-- 0127_hema_rating_history.sql
--
-- Normalized per-fighter HEMA rating time-series, powering the ranking-history
-- chart on the public fighter profile. The daily sync worker appends one row
-- per linked fighter × weapon × category per day (idempotent on the unique
-- key); a one-time backfill mines the accumulated hema_ratings_snapshots so the
-- chart is non-empty from day one. Keyed by hema_ratings_id (the stable upstream
-- id stored on global_persons), so history survives profile re-links.

CREATE TABLE IF NOT EXISTS hema_rating_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hema_ratings_id TEXT NOT NULL,
  weapon TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  weighted_rating NUMERIC NOT NULL,
  rank INTEGER,
  captured_at DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hema_ratings_id, weapon, category, captured_at)
);

CREATE INDEX IF NOT EXISTS hema_rating_history_lookup_idx
  ON hema_rating_history (hema_ratings_id, weapon, captured_at);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Mirrors hema_ratings_snapshots (0011): service role writes; authenticated read.
-- Public consumers reach this only via the API (service role), never directly.
ALTER TABLE hema_rating_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON hema_rating_history
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated_read" ON hema_rating_history
  FOR SELECT
  TO authenticated
  USING (true);

NOTIFY pgrst, 'reload schema';
