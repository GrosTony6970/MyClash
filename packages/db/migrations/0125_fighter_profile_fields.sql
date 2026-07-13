-- 0125_fighter_profile_fields.sql
--
-- Fighter profile expansion (public-facing identity):
--   * alias            — a nickname shown in italic grey below the name.
--   * website_url / instagram_url / youtube_url — external/social links.
--   * practicing_since_year — the year the fighter started HEMA (experience).
--   * fighter_weapons.style — a per-weapon style/tradition (free text with UI
--     suggestions like KDF / Italian longsword / Bolognese). No CHECK: the value
--     is open-ended, unlike the controlled `level` enum added in 0112.
-- All nullable; existing rows are unaffected.

ALTER TABLE global_persons
  ADD COLUMN IF NOT EXISTS alias TEXT,
  ADD COLUMN IF NOT EXISTS website_url TEXT,
  ADD COLUMN IF NOT EXISTS instagram_url TEXT,
  ADD COLUMN IF NOT EXISTS youtube_url TEXT,
  ADD COLUMN IF NOT EXISTS practicing_since_year SMALLINT;

ALTER TABLE fighter_weapons
  ADD COLUMN IF NOT EXISTS style TEXT;

NOTIFY pgrst, 'reload schema';
