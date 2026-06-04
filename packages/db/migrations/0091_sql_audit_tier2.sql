-- Migration 0091 — Tier 2 SQL audit fixes
--
-- Outcome of the schema-level + query-level audit recorded in the
-- session plan. Adds three indexes for hot read paths and two
-- correctness constraints (an FK for the forfeit hierarchy + a
-- CHECK for the referee_assignments scope polymorphism).
--
-- Audit summary that prompted these specific changes:
--   * referee_assignments(pool_id) — uncovered by every public
--     listPoolsWithMatches + getPublishedRefereesByPool call
--   * referee_qualifications(event_id) — composite UNIQUE doesn't
--     lead with event_id, event-tab loads do a full scan today
--   * match_forfeits(tournament_id) partial — bracket finalization
--     walks root forfeits per-tournament
--   * match_forfeits.parent_forfeit_id — referenced
--     match_forfeits.id without a constraint (referential integrity
--     hole on cascading forfeits)
--   * referee_assignments(scope_type) — polymorphic discriminator
--     enforced only in app code; a buggy writer could create rows
--     with scope_type='match' but pool_id set

-- ── 0. Pre-flight: refuse to ship the scope CHECK on dirty data ─────
-- The ADD CONSTRAINT below validates every existing row. If any
-- referee_assignments row violates the predicate the migration
-- aborts before any change. Operator's deploy is full wipe+redeploy
-- so dirty data is unlikely; this guard avoids the otherwise-cryptic
-- "constraint violation during ADD CONSTRAINT" failure.
DO $$
DECLARE bad_count integer;
BEGIN
  SELECT COUNT(*) INTO bad_count FROM referee_assignments
   WHERE NOT (
     (scope_type = 'lice'  AND lice_id  IS NOT NULL AND pool_id IS NULL    AND match_id IS NULL) OR
     (scope_type = 'pool'  AND pool_id  IS NOT NULL AND lice_id IS NULL    AND match_id IS NULL) OR
     (scope_type = 'match' AND match_id IS NOT NULL AND lice_id IS NULL    AND pool_id  IS NULL)
   );
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'referee_assignments has % rows violating the scope CHECK predicate; clean before applying migration 0091', bad_count;
  END IF;
END $$;

-- ── 1. referee_assignments perf indexes ─────────────────────────────
-- Pool-scoped reads dominate. The composite supports
-- WHERE pool_id = $1 AND scope_type = 'pool' without a second
-- index pass. Single-column index covers the bare
-- WHERE pool_id IN (...) used by the realtime exchange listener.
CREATE INDEX IF NOT EXISTS referee_assignments_pool_id_idx
  ON referee_assignments (pool_id);
CREATE INDEX IF NOT EXISTS referee_assignments_pool_scope_idx
  ON referee_assignments (pool_id, scope_type);

-- ── 2. referee_qualifications perf index ────────────────────────────
-- Event-tab loads scan all qualifications per event; only the
-- composite UNIQUE (person_id, event_id, role) exists today and
-- the leading column is person_id, so it doesn't help an event_id
-- filter.
CREATE INDEX IF NOT EXISTS referee_qualifications_event_id_idx
  ON referee_qualifications (event_id);

-- ── 3. match_forfeits perf index ────────────────────────────────────
-- Bracket finalization walks root forfeits per tournament. Partial
-- on parent_forfeit_id IS NULL keeps the index lean — sub-forfeits
-- are reached via the new FK below.
CREATE INDEX IF NOT EXISTS match_forfeits_tournament_id_idx
  ON match_forfeits (tournament_id)
  WHERE parent_forfeit_id IS NULL;

-- ── 4. match_forfeits hierarchy FK ──────────────────────────────────
-- parent_forfeit_id referenced match_forfeits.id without a
-- constraint. ON DELETE SET NULL so deleting a root forfeit
-- doesn't cascade-wipe replacement records.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'match_forfeits_parent_fkey'
  ) THEN
    ALTER TABLE match_forfeits
      ADD CONSTRAINT match_forfeits_parent_fkey
      FOREIGN KEY (parent_forfeit_id)
      REFERENCES match_forfeits (id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ── 5. referee_assignments scope CHECK ──────────────────────────────
-- Validate the polymorphic (scope_type) → (lice_id | pool_id |
-- match_id) one-of relationship at the DB level. The pre-flight
-- block above guarantees this can't fail on existing rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'referee_assignments_scope_check'
  ) THEN
    ALTER TABLE referee_assignments
      ADD CONSTRAINT referee_assignments_scope_check
      CHECK (
        (scope_type = 'lice'  AND lice_id  IS NOT NULL AND pool_id IS NULL AND match_id IS NULL) OR
        (scope_type = 'pool'  AND pool_id  IS NOT NULL AND lice_id IS NULL AND match_id IS NULL) OR
        (scope_type = 'match' AND match_id IS NOT NULL AND lice_id IS NULL AND pool_id  IS NULL)
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
