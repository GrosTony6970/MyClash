-- Migration 0057: add the missing matches.phase_id → phases.id FK.
--
-- The initial schema (0001_init.sql:390) declared phase_id UUID NOT NULL
-- without REFERENCES — the sibling pools and bracket_slots tables in the
-- same file got it right (lines 338, 355). PostgREST can't resolve
-- embedded `phases(...)` selects against matches without the FK, so
-- GET /matches/:id/display has been 400-ing whenever the scoreboard
-- supabase-js call walks the relationship.
--
-- ON DELETE CASCADE mirrors the sibling tables: deleting a phase already
-- cascades to its pools and bracket_slots, so matches should follow.

-- 1. Drop any orphan rows whose phase_id has no corresponding phases row.
--    With the FK missing since 0001 it's possible (though unlikely) that
--    such rows exist; this clears the path for the constraint to land
--    cleanly. Once the FK exists, ON DELETE CASCADE prevents new orphans.
DELETE FROM matches
WHERE phase_id NOT IN (SELECT id FROM phases);

-- 2. Add the FK constraint.
ALTER TABLE matches
  ADD CONSTRAINT matches_phase_id_fkey
  FOREIGN KEY (phase_id) REFERENCES phases(id) ON DELETE CASCADE;

-- 3. Force PostgREST to refresh its schema cache so the relationship
--    becomes queryable without a service restart. Idempotent + no-op
--    when PostgREST isn't listening.
NOTIFY pgrst, 'reload schema';
