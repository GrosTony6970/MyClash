-- ============================================================
-- MyClash — RLS for global_persons and referee_profiles
-- Migration: 0024_global_persons_rls.sql
-- Dep: 0023_global_persons.sql, 0002_rls.sql
-- ============================================================

-- ── 1. Drop old fighters policies (table is now global_persons) ───────────────
DROP POLICY IF EXISTS "fighters_select" ON global_persons;
DROP POLICY IF EXISTS "fighters_insert" ON global_persons;
DROP POLICY IF EXISTS "fighters_update" ON global_persons;

-- ── 2. Re-enable RLS + new global_persons policies ───────────────────────────
ALTER TABLE global_persons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "global_persons_select" ON global_persons
  FOR SELECT USING (TRUE);

CREATE POLICY "global_persons_insert" ON global_persons
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "global_persons_update" ON global_persons
  FOR UPDATE
  USING (
    is_super_admin()
    OR claimed_by_user_id = auth.uid()
  );

-- ── 3. referee_profiles RLS ───────────────────────────────────────────────────
ALTER TABLE referee_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "referee_profiles_select" ON referee_profiles
  FOR SELECT USING (TRUE);

CREATE POLICY "referee_profiles_write" ON referee_profiles
  FOR ALL
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM global_persons gp
      WHERE gp.id = referee_profiles.global_person_id
        AND gp.claimed_by_user_id = auth.uid()
    )
  )
  WITH CHECK (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM global_persons gp
      WHERE gp.id = referee_profiles.global_person_id
        AND gp.claimed_by_user_id = auth.uid()
    )
  );

-- ── 4. Update fighter_clubs / fighter_weapons policies to use renamed column ──
-- Drop old policies
DROP POLICY IF EXISTS "fighter_clubs_write" ON fighter_clubs;
DROP POLICY IF EXISTS "fighter_weapons_write" ON fighter_weapons;

-- Recreate with global_person_id column name
CREATE POLICY "fighter_clubs_write" ON fighter_clubs
  FOR ALL
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM global_persons gp
      WHERE gp.id = fighter_clubs.global_person_id
        AND gp.claimed_by_user_id = auth.uid()
    )
  )
  WITH CHECK (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM global_persons gp
      WHERE gp.id = fighter_clubs.global_person_id
        AND gp.claimed_by_user_id = auth.uid()
    )
  );

CREATE POLICY "fighter_weapons_write" ON fighter_weapons
  FOR ALL
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM global_persons gp
      WHERE gp.id = fighter_weapons.global_person_id
        AND gp.claimed_by_user_id = auth.uid()
    )
  )
  WITH CHECK (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM global_persons gp
      WHERE gp.id = fighter_weapons.global_person_id
        AND gp.claimed_by_user_id = auth.uid()
    )
  );
