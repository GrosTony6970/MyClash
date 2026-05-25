-- Migration 0062: allow tagging unclaimed persons as referees.
--
-- Before this migration, `event_referees`, `referee_qualifications`,
-- and `referee_assignments` all keyed exclusively on `user_id` (the
-- Supabase auth UUID). Unclaimed persons (no auth row yet) couldn't be
-- referees, blocking the organiser flow where a roster is built before
-- everyone has gone through the claim invitation.
--
-- The three tables now accept either `user_id` (claimed) OR `person_id`
-- (= `global_persons.id`, exists independently of auth). Exactly one is
-- set per row, enforced by a CHECK constraint. When the person later
-- claims their account, `backfillRefereeIdentity` (called from the
-- onboarding service) flips `person_id` → `user_id` so the rest of the
-- system keeps treating them as a normal claimed referee.
--
-- Existing rows: `user_id IS NOT NULL` + `person_id IS NULL` satisfies
-- the new CHECK with no data migration needed.

-- ── event_referees ───────────────────────────────────────────────────────────
ALTER TABLE event_referees
  DROP CONSTRAINT IF EXISTS event_referees_pkey,
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS id        UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS person_id UUID REFERENCES global_persons(id) ON DELETE CASCADE;

ALTER TABLE event_referees
  ADD CONSTRAINT event_referees_pkey PRIMARY KEY (id);

ALTER TABLE event_referees
  ADD CONSTRAINT event_referees_identity_check
    CHECK ((user_id IS NOT NULL) <> (person_id IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS event_referees_event_user_idx
  ON event_referees (event_id, user_id) WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS event_referees_event_person_idx
  ON event_referees (event_id, person_id) WHERE person_id IS NOT NULL;

-- ── referee_qualifications ───────────────────────────────────────────────────
ALTER TABLE referee_qualifications
  DROP CONSTRAINT IF EXISTS referee_qualifications_user_id_event_id_role_key,
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS person_id UUID REFERENCES global_persons(id) ON DELETE CASCADE;

ALTER TABLE referee_qualifications
  ADD CONSTRAINT referee_qualifications_identity_check
    CHECK ((user_id IS NOT NULL) <> (person_id IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS referee_quals_user_event_role_idx
  ON referee_qualifications (user_id, event_id, role) WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS referee_quals_person_event_role_idx
  ON referee_qualifications (person_id, event_id, role) WHERE person_id IS NOT NULL;

-- ── referee_assignments ──────────────────────────────────────────────────────
ALTER TABLE referee_assignments
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS person_id UUID REFERENCES global_persons(id) ON DELETE CASCADE;

ALTER TABLE referee_assignments
  ADD CONSTRAINT referee_assignments_identity_check
    CHECK ((user_id IS NOT NULL) <> (person_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS referee_assignments_person_idx
  ON referee_assignments (person_id) WHERE person_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
