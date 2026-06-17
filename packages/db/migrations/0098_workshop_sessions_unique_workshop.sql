-- 0098_workshop_sessions_unique_workshop.sql
--
-- A workshop has exactly one session (the scheduled block on the
-- workshop schedule board). The session-create endpoint upserts on
-- workshop_id, which requires a UNIQUE constraint to resolve the
-- conflict target. Historically workshop_sessions had no uniqueness
-- on workshop_id, so the upsert would have failed at runtime.
--
-- If any legacy duplicates exist they must be collapsed before the
-- constraint is added — keep the earliest session per workshop.

DELETE FROM workshop_sessions ws
USING workshop_sessions keep
WHERE ws.workshop_id = keep.workshop_id
  AND ws.ctid > keep.ctid;

ALTER TABLE workshop_sessions
  ADD CONSTRAINT workshop_sessions_workshop_id_key UNIQUE (workshop_id);

NOTIFY pgrst, 'reload schema';
