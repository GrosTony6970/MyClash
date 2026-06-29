-- 0112_fighter_weapons_level.sql
--
-- Fighters can now declare a self-rated skill level per weapon on their
-- profile (Just for fun / Beginner / Intermediate / Advanced), shown next to
-- the favourite star. Nullable — a selected weapon with no declared level is
-- the norm; the CHECK keeps the value within the known set.

ALTER TABLE fighter_weapons
  ADD COLUMN IF NOT EXISTS level TEXT
  CHECK (level IN ('just_for_fun', 'beginner', 'intermediate', 'advanced'));

NOTIFY pgrst, 'reload schema';
