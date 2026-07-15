-- 0137: referee compensation — open roles to the skills catalog + add a minimum payout.
--
-- Two independent changes to the referee-compensation feature:
--
--   1. Roles were locked to the three hardcoded IDs 'arbitre_declarant' /
--      'arbitre_assesseur' / 'arbitre_table' by a CHECK on
--      referee_compensation_role_rates.referee_role. Those IDs are in fact the
--      three *system* referee_skills IDs, and referee_assignments.role stores any
--      referee_skills.id — including per-event custom skills (custom-…). Dropping
--      the CHECK lets a plan carry a rate for any skill (system or custom) so
--      custom-skill referees actually get compensated instead of falling through
--      to 0. No FK to referee_skills on purpose: plans are org-level/reusable while
--      custom skills are per-event/deletable; computeReport already tolerates an
--      unknown role (looks up rate, falls back to 0). Existing FFAMHE seed rows
--      already reference the three system-skill IDs, so nothing to backfill.
--
--   2. Add a per-event minimum payout (a floor), the sibling of the existing
--      max_compensation_amount cap. NULL = no minimum.

ALTER TABLE referee_compensation_role_rates
  DROP CONSTRAINT IF EXISTS referee_compensation_role_rates_referee_role_check;

ALTER TABLE referee_compensation_event_settings
  ADD COLUMN IF NOT EXISTS min_compensation_amount NUMERIC(10,2);
