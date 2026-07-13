-- 0123_fighter_manual_medals.sql
-- Manually imported external-tournament podiums (results not tracked by the
-- app). Keyed by the fighter's cross-event identity (global_persons). Not
-- event/tournament-scoped -> no archive-guard entry.

CREATE TABLE IF NOT EXISTS fighter_manual_medals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  global_person_id UUID NOT NULL REFERENCES global_persons(id) ON DELETE CASCADE,
  competition TEXT NOT NULL,
  year INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  weapon TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fighter_manual_medals_rank_check CHECK (rank IN (1, 2, 3))
);

CREATE INDEX IF NOT EXISTS fighter_manual_medals_person_idx
  ON fighter_manual_medals(global_person_id, year DESC, rank);

ALTER TABLE fighter_manual_medals ENABLE ROW LEVEL SECURITY;

-- Public read (medals appear on the fighter profile); owner or super-admin write.
CREATE POLICY "fighter_manual_medals_select" ON fighter_manual_medals FOR SELECT
  USING (TRUE);

CREATE POLICY "fighter_manual_medals_write" ON fighter_manual_medals
  FOR ALL
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM global_persons gp
      WHERE gp.id = fighter_manual_medals.global_person_id
        AND gp.claimed_by_user_id = auth.uid()
    )
  )
  WITH CHECK (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM global_persons gp
      WHERE gp.id = fighter_manual_medals.global_person_id
        AND gp.claimed_by_user_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
