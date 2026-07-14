-- 0133_weapon_catalog_seed.sql
-- Curate the shared weapon_catalog (created + seeded in 0017) into the strict
-- baseline that tournaments/workshops now pick from. Two renames plus an
-- idempotent seed of the agreed 25-weapon list.
--
-- Renames (both change the SLUG so it stays = slugify(name); the fighter-import
-- resolver keys on slugify(name), so a divergent slug would silently create a
-- duplicate catalog row):
--   * Ringen            -> Wrestling        (slug ringen -> wrestling)
--   * Sword and Buckler -> Sword & Buckler  (slug sword-and-buckler -> sword-buckler)
--
-- Both renames are done via a merge-or-rename block so they are safe even when
-- the target slug already exists as a historical row back-filled from
-- tournaments.weapon (migration 0017:28-35) — a blind slug UPDATE would hit
-- UNIQUE(slug) and abort the whole migration.
--
-- Naming convention: '&' everywhere. 'Other' is the deliberate catch-all for
-- niche weapons under the new catalog-only tournament/workshop selectors.
-- Idempotent: renames are guarded, seed uses ON CONFLICT (slug) DO NOTHING.

DO $$
DECLARE
  r        RECORD;
  old_id   UUID;
  new_id   UUID;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('ringen',            'wrestling',     'Wrestling'),
      ('sword-and-buckler', 'sword-buckler', 'Sword & Buckler')
    ) AS t(old_slug, new_slug, new_name)
  LOOP
    SELECT id INTO old_id FROM weapon_catalog WHERE slug = r.old_slug;
    SELECT id INTO new_id FROM weapon_catalog WHERE slug = r.new_slug;

    IF old_id IS NOT NULL AND new_id IS NOT NULL THEN
      -- Both rows exist (target back-filled from historical data). Merge the
      -- old row's fighter links into the target (respecting the
      -- UNIQUE(global_person_id, weapon_id) constraint), then drop the old row.
      UPDATE fighter_weapons fw
        SET weapon_id = new_id
        WHERE fw.weapon_id = old_id
          AND NOT EXISTS (
            SELECT 1 FROM fighter_weapons fw2
            WHERE fw2.global_person_id = fw.global_person_id
              AND fw2.weapon_id = new_id
          );
      DELETE FROM fighter_weapons WHERE weapon_id = old_id;   -- leftover dup links
      DELETE FROM weapon_catalog WHERE id = old_id;
      UPDATE weapon_catalog
        SET name = r.new_name, active = TRUE, updated_at = NOW()
        WHERE id = new_id;
    ELSIF old_id IS NOT NULL THEN
      -- Only the old row exists: rename slug + name in place.
      UPDATE weapon_catalog
        SET slug = r.new_slug, name = r.new_name, updated_at = NOW()
        WHERE id = old_id;
    ELSIF new_id IS NOT NULL THEN
      -- Only the target row exists: normalize its display name + activate.
      UPDATE weapon_catalog
        SET name = r.new_name, active = TRUE, updated_at = NOW()
        WHERE id = new_id;
    END IF;
  END LOOP;
END $$;

INSERT INTO weapon_catalog (slug, name)
VALUES
  ('longsword',         'Longsword'),
  ('rapier',            'Rapier'),
  ('sidesword',         'Sidesword'),
  ('sabre',             'Sabre'),
  ('sword-buckler',     'Sword & Buckler'),
  ('messer',            'Messer'),
  ('dagger',            'Dagger'),
  ('wrestling',         'Wrestling'),
  ('spear',             'Spear'),
  ('staff',             'Staff'),
  ('multiple-weapons',  'Multiple Weapons'),
  ('rapier-dagger',     'Rapier & Dagger'),
  ('sidesword-buckler', 'Sidesword & Buckler'),
  ('sidesword-dagger',  'Sidesword & Dagger'),
  ('smallsword',        'Smallsword'),
  ('cutting',           'Cutting'),
  ('unarmed',           'Unarmed'),
  ('other',             'Other'),
  ('singlestick',       'Singlestick'),
  ('bataireacht',       'Bataireacht'),
  ('sickle',            'Sickle'),
  ('pollaxe',           'Pollaxe'),
  ('sword-shield',      'Sword & Shield'),
  ('montante',          'Montante'),
  ('partisan',          'Partisan')
ON CONFLICT (slug) DO NOTHING;
