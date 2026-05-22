-- Migration 0046: track provenance of global_persons.is_referee.
--
-- When ensureEventReferee promotes a person to referee by flipping
-- is_referee NULL -> 'true', we record is_referee_event_managed = true.
-- When the last event_referees row for that user is removed,
-- removeEventReferee clears both flags atomically — but only if the
-- managed flag is still true, so manually-set referee tags are preserved.

ALTER TABLE global_persons
  ADD COLUMN IF NOT EXISTS is_referee_event_managed BOOLEAN NOT NULL DEFAULT FALSE;
