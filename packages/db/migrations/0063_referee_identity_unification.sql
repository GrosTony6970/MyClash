-- Migration 0063: collapse the R6 dual-identity (user_id XOR person_id) on the
-- three referee tables down to a single canonical key — person_id.
--
-- R6 introduced person_id alongside the existing user_id, with a CHECK constraint
-- enforcing exactly-one-of. Every reader had to handle both columns, and a
-- back-fill in auth.service flipped person_id → user_id on claim. This was
-- correct but heavyweight.
--
-- Post-0063: there is no user_id column on event_referees, referee_qualifications,
-- or referee_assignments. Callers that start from a Supabase auth user_id
-- (JWT-bearing endpoints like "my schedule", notification dispatch, etc.)
-- resolve to person_id once via global_persons.claimed_by_user_id and pass
-- person_id throughout. Treating user_id as a derived attribute, not a key.
--
-- This migration assumes a clean deploy (no orphan rows). NOT NULL on person_id
-- will fail if any row was left in the user_id-only state.

-- ── global_persons.claimed_by_user_id UNIQUE ─────────────────────────────────
-- The resolver query `SELECT id FROM global_persons WHERE claimed_by_user_id = $1`
-- must be deterministic. A nullable FK (no constraint) allowed duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS global_persons_claimed_by_user_id_uk
  ON global_persons (claimed_by_user_id)
  WHERE claimed_by_user_id IS NOT NULL;

-- ── event_referees ───────────────────────────────────────────────────────────
ALTER TABLE event_referees
  DROP CONSTRAINT IF EXISTS event_referees_identity_check;
DROP INDEX IF EXISTS event_referees_event_user_idx;
DROP INDEX IF EXISTS event_referees_event_person_idx;
ALTER TABLE event_referees
  DROP COLUMN IF EXISTS user_id,
  ALTER COLUMN person_id SET NOT NULL;
CREATE UNIQUE INDEX event_referees_event_person_idx
  ON event_referees (event_id, person_id);

-- ── referee_qualifications ───────────────────────────────────────────────────
ALTER TABLE referee_qualifications
  DROP CONSTRAINT IF EXISTS referee_qualifications_identity_check;
DROP INDEX IF EXISTS referee_quals_user_event_role_idx;
DROP INDEX IF EXISTS referee_quals_person_event_role_idx;
ALTER TABLE referee_qualifications
  DROP COLUMN IF EXISTS user_id,
  ALTER COLUMN person_id SET NOT NULL;
CREATE UNIQUE INDEX referee_quals_person_event_role_idx
  ON referee_qualifications (person_id, event_id, role);

-- ── referee_assignments ──────────────────────────────────────────────────────
-- Drop the view that selects ra.user_id before we can drop the column.
DROP VIEW IF EXISTS vw_tournament_query_referees;

ALTER TABLE referee_assignments
  DROP CONSTRAINT IF EXISTS referee_assignments_identity_check;
DROP INDEX IF EXISTS referee_assignments_person_idx;
ALTER TABLE referee_assignments
  DROP COLUMN IF EXISTS user_id,
  ALTER COLUMN person_id SET NOT NULL;
CREATE INDEX referee_assignments_person_idx ON referee_assignments (person_id);

-- ── RLS rewrites ─────────────────────────────────────────────────────────────
-- Three earlier policies (0002_rls.sql, 0041) referenced referee_*.user_id
-- directly to grant referees "self-read" on their own rows. Now resolve via
-- global_persons.claimed_by_user_id → person_id.
DROP POLICY IF EXISTS "referee_qualifications_select" ON referee_qualifications;
CREATE POLICY "referee_qualifications_select" ON referee_qualifications FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM global_persons gp
      WHERE gp.id = referee_qualifications.person_id
        AND gp.claimed_by_user_id = auth.uid()
    )
    OR is_org_member(event_org_id(event_id))
  );

DROP POLICY IF EXISTS "referee_assignments_select" ON referee_assignments;
CREATE POLICY "referee_assignments_select" ON referee_assignments FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM global_persons gp
      WHERE gp.id = referee_assignments.person_id
        AND gp.claimed_by_user_id = auth.uid()
    )
    OR is_org_member(event_org_id(event_id))
    OR EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = referee_assignments.event_id
        AND e.status IN ('published','running','completed')
    )
  );

DROP POLICY IF EXISTS "event_referees_select" ON event_referees;
CREATE POLICY "event_referees_select" ON event_referees FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM global_persons gp
      WHERE gp.id = event_referees.person_id
        AND gp.claimed_by_user_id = auth.uid()
    )
    OR is_org_member(event_org_id(event_id))
  );

-- ── tournament_query view rewrite ────────────────────────────────────────────
-- Replace user_id projection with person_id and resolve the judge name via
-- global_persons instead of the per-event persons table.
CREATE OR REPLACE VIEW vw_tournament_query_referees AS
SELECT
  COALESCE(t_pool.id, t_match.id) AS tournament_id,
  ra.event_id,
  ra.person_id,
  trim(COALESCE(gp.given_name, '') || ' ' || COALESCE(gp.family_name, '')) AS judge_name,
  ra.pool_id,
  pool.name AS pool_name,
  ra.match_id,
  ra.role,
  ra.status
FROM referee_assignments ra
LEFT JOIN global_persons gp ON gp.id = ra.person_id
LEFT JOIN pools pool ON pool.id = ra.pool_id
LEFT JOIN phases ph_pool ON ph_pool.id = pool.phase_id
LEFT JOIN tournaments t_pool ON t_pool.id = ph_pool.tournament_id
LEFT JOIN matches match ON match.id = ra.match_id
LEFT JOIN phases ph_match ON ph_match.id = match.phase_id
LEFT JOIN tournaments t_match ON t_match.id = ph_match.tournament_id;

NOTIFY pgrst, 'reload schema';
