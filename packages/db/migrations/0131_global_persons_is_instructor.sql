-- Migration 0131: add global_persons.is_instructor role flag.
--
-- Fourth role flag alongside is_fighter / is_referee / is_workshop_participant
-- (added in 0023). Auto-ticked (tick-only) when an organiser tags someone as an
-- event instructor or assigns them to a workshop; never auto-cleared, matching
-- the is_referee provenance model.

ALTER TABLE global_persons
  ADD COLUMN IF NOT EXISTS is_instructor BOOLEAN NOT NULL DEFAULT FALSE;
