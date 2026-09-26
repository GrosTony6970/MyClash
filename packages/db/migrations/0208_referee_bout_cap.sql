-- 0208: the referee's daily bout cap, and the dead rest switch goes (W1.3, ADR-019).
--
-- ADR-019: a person referees at most `max_bouts_per_day` bouts in one Event day, counted
-- as the distinct bouts under their duties; 0 means no cap (the default, so no Event
-- changes until an organiser sets one). Going past it is Discouraged: amber, the
-- organiser may confirm, and auto-assign never does it.
--
-- `enforce_dedicated_referee_rest` was stored, sent to the engine and read by nothing;
-- its two documented meanings contradicted each other and neither is a rule the operator
-- kept (ADR-019 "The dead switch goes"). Rest between duties is the existing
-- `enforce_referee_no_back_to_back` + `referee_rest_min_slots`.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table, no policy change: one column in, one column out of
-- pool_assignment_settings, which keeps its policies (0002_rls.sql). The API's service
-- role is its only reader and writer.

ALTER TABLE pool_assignment_settings
  ADD COLUMN IF NOT EXISTS max_bouts_per_day INTEGER NOT NULL DEFAULT 0
    CONSTRAINT pool_assignment_settings_max_bouts_per_day_check CHECK (max_bouts_per_day >= 0);

ALTER TABLE pool_assignment_settings
  DROP COLUMN IF EXISTS enforce_dedicated_referee_rest;
