-- 0126_fighter_public_visibility.sql
--
-- Per-field public visibility for fighter profiles. A JSON map of
-- { fieldKey: boolean } where true = shown on the public profile. Keys are
-- resolved against defaults server-side (see FightersService): most fields
-- default to public, date_of_birth defaults to hidden. Absent/`{}` = defaults,
-- i.e. current behaviour. Enforcement happens in the public read projection,
-- which also strips contact PII (email, claimed_by_user_id) that older list
-- endpoints leaked.

ALTER TABLE global_persons
  ADD COLUMN IF NOT EXISTS public_visibility JSONB NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
