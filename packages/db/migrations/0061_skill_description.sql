-- Migration 0061: optional description on referee_skills (R4 of the
-- Staffing overhaul).
--
-- Up to R3 the skill catalog edit modal exposed only name + color. R4
-- adds a free-text description (≤ 500 chars, enforced at the DTO
-- layer) shown as an italic subtitle in the catalog and as a `title`
-- tooltip on the skill chip. System skills can carry a description too
-- (the is_system flag only blocks rename + delete).
--
-- Default '' so existing rows pass NOT NULL without backfill, and the
-- UI can treat empty == "no description" uniformly.

ALTER TABLE referee_skills
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

-- Force PostgREST to refresh its schema cache so the new column becomes
-- queryable without a service restart.
NOTIFY pgrst, 'reload schema';
