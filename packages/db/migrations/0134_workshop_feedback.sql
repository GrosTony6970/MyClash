-- Migration 0133: workshop_feedback — participant ratings + comments.
--
-- One editable rating (1..5) + optional comment per participant per workshop.
-- `rater_person_id` is the event-scoped persons.id (matches
-- workshop_enrollments.user_id). Feedback is shown ANONYMOUSLY to instructors —
-- the API never projects the rater's identity in the instructor view.
--
-- Eligibility (enrolled + the session has started) is enforced in the API, not
-- the schema. RLS mirrors workshop_enrollments: org members of the owning event
-- (and super admins) can read/write; all real access is via the service role.

CREATE TABLE IF NOT EXISTS workshop_feedback (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id     UUID        NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  rater_person_id UUID        NOT NULL,
  rating          SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workshop_id, rater_person_id)
);

CREATE INDEX IF NOT EXISTS idx_workshop_feedback_workshop_id
  ON workshop_feedback(workshop_id);

ALTER TABLE workshop_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workshop_feedback_select" ON workshop_feedback FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM workshops w
      WHERE w.id = workshop_feedback.workshop_id
        AND is_org_member(event_org_id(w.event_id))
    )
  );

CREATE POLICY "workshop_feedback_write" ON workshop_feedback FOR ALL
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM workshops w
      WHERE w.id = workshop_feedback.workshop_id
        AND has_org_role(event_org_id(w.event_id), 'editor')
    )
  );
