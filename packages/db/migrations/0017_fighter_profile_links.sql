-- ============================================================
-- MyClash - Fighter profile clubs and weapon catalog
-- ============================================================

CREATE TABLE IF NOT EXISTS weapon_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO weapon_catalog (slug, name)
VALUES
  ('longsword', 'Longsword'),
  ('rapier', 'Rapier'),
  ('sidesword', 'Sidesword'),
  ('sabre', 'Sabre'),
  ('sword-and-buckler', 'Sword and Buckler'),
  ('messer', 'Messer'),
  ('dagger', 'Dagger'),
  ('ringen', 'Ringen'),
  ('spear', 'Spear'),
  ('staff', 'Staff')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO weapon_catalog (slug, name)
SELECT DISTINCT
  lower(regexp_replace(unaccent(trim(t.weapon)), '[^a-zA-Z0-9]+', '-', 'g')) AS slug,
  trim(t.weapon) AS name
FROM tournaments t
WHERE t.weapon IS NOT NULL
  AND trim(t.weapon) <> ''
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS fighter_clubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fighter_id UUID NOT NULL REFERENCES fighters(id) ON DELETE CASCADE,
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  start_year INTEGER,
  end_year INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fighter_clubs_role_check CHECK (role IN ('main', 'secondary', 'previous')),
  UNIQUE(fighter_id, club_id, role)
);

CREATE TABLE IF NOT EXISTS fighter_weapons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fighter_id UUID NOT NULL REFERENCES fighters(id) ON DELETE CASCADE,
  weapon_id UUID NOT NULL REFERENCES weapon_catalog(id) ON DELETE CASCADE,
  favorite BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(fighter_id, weapon_id)
);

CREATE INDEX IF NOT EXISTS fighter_clubs_fighter_idx
  ON fighter_clubs(fighter_id, role, sort_order);
CREATE INDEX IF NOT EXISTS fighter_weapons_fighter_idx
  ON fighter_weapons(fighter_id, favorite DESC, sort_order);

ALTER TABLE weapon_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE fighter_clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fighter_weapons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "weapon_catalog_select" ON weapon_catalog FOR SELECT
  USING (TRUE);

CREATE POLICY "weapon_catalog_write" ON weapon_catalog FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "fighter_clubs_select" ON fighter_clubs FOR SELECT
  USING (TRUE);

CREATE POLICY "fighter_clubs_write" ON fighter_clubs FOR ALL
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM fighters f
      WHERE f.id = fighter_clubs.fighter_id
        AND f.claimed_by_user_id = auth.uid()
    )
  )
  WITH CHECK (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM fighters f
      WHERE f.id = fighter_clubs.fighter_id
        AND f.claimed_by_user_id = auth.uid()
    )
  );

CREATE POLICY "fighter_weapons_select" ON fighter_weapons FOR SELECT
  USING (TRUE);

CREATE POLICY "fighter_weapons_write" ON fighter_weapons FOR ALL
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM fighters f
      WHERE f.id = fighter_weapons.fighter_id
        AND f.claimed_by_user_id = auth.uid()
    )
  )
  WITH CHECK (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM fighters f
      WHERE f.id = fighter_weapons.fighter_id
        AND f.claimed_by_user_id = auth.uid()
    )
  );
