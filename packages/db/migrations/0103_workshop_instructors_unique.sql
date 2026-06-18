-- 0103_workshop_instructors_unique.sql
--
-- Tagging an instructor on a workshop upserts with
-- ON CONFLICT (workshop_id, global_person_id), but workshop_instructors only
-- had an `id` PK — no matching unique constraint — so the upsert 400'd
-- ("no unique or exclusion constraint matching the ON CONFLICT specification").
-- Add the composite unique so the upsert resolves and a person can't be
-- tagged twice on the same workshop.
--
-- Composite unique (not UNIQUE(workshop_id) alone) keeps workshop → instructors
-- a to-MANY relationship, so PostgREST still embeds it as an array.
--
-- Collapse any pre-existing duplicates first (keep the earliest row per pair).

DELETE FROM workshop_instructors wi
USING workshop_instructors keep
WHERE wi.workshop_id = keep.workshop_id
  AND wi.global_person_id IS NOT DISTINCT FROM keep.global_person_id
  AND wi.ctid > keep.ctid;

ALTER TABLE workshop_instructors
  ADD CONSTRAINT workshop_instructors_workshop_person_key UNIQUE (workshop_id, global_person_id);

NOTIFY pgrst, 'reload schema';
