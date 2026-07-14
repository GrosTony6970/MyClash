-- Migration 0132: add 'refused' workshop enrollment status.
--
-- Instructors can refuse an enrollee from their workshop (Phase 3 moderation).
-- 'refused' is a soft, sticky state — unlike self-cancel, which hard-deletes the
-- row — so a refused person cannot silently re-register. Accepting a refused
-- person clears the row back to 'confirmed'.

ALTER TABLE workshop_enrollments
  DROP CONSTRAINT IF EXISTS enrollment_status_check;

ALTER TABLE workshop_enrollments
  ADD CONSTRAINT enrollment_status_check
  CHECK (status IN ('intent', 'confirmed', 'waitlisted', 'cancelled', 'refused'));
