-- 0100_workshops_status_check.sql
--
-- workshops.status already exists (NOT NULL DEFAULT 'draft') but had no
-- CHECK. Pin the lifecycle to the four states the admin UI exposes and
-- the public gate relies on. Existing rows default to 'draft', so the
-- constraint is added NOT VALID then validated immediately (cheap here,
-- and the safe pattern for larger tables).
--
-- Public visibility (mirrors TOURNAMENT_PUBLIC_STATUSES): published,
-- running, completed are public; draft is organizer-only.

ALTER TABLE workshops
  ADD CONSTRAINT workshops_status_check
  CHECK (status IN ('draft', 'published', 'running', 'completed')) NOT VALID;

ALTER TABLE workshops VALIDATE CONSTRAINT workshops_status_check;

NOTIFY pgrst, 'reload schema';
