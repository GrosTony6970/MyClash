-- 0042_referee_qualifications_role_open.sql
-- Drops the hardcoded CHECK on referee_qualifications.role so custom skill ids
-- (created via referee_skills in mig 0041) can be used as qualification roles.
-- The API layer enforces validity (role must reference an existing referee_skills.id).

ALTER TABLE referee_qualifications DROP CONSTRAINT IF EXISTS referee_role_check;
