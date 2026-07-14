-- 0130_workshops_weapon.sql
-- Adds an optional weapon/discipline to workshops (free text, e.g. 'Longsword',
-- 'Rapier'), mirroring tournaments.weapon (0001_init). Suggestions in the admin
-- editor are fed from the shared weapon_catalog (GET /api/v1/weapons), but the
-- stored value is free text so custom entries survive. Powers the per-weapon
-- breakdown on the personal Workshop profile (/me/profile?tab=workshop).
-- Additive: existing rows get NULL, no backfill required.
ALTER TABLE workshops
  ADD COLUMN weapon text;

NOTIFY pgrst, 'reload schema';
