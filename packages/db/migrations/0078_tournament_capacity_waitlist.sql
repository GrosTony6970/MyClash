-- Tournament capacity + waitlist.
--
-- Two new optional caps on tournaments:
--   max_participants — when set, the registrations create endpoint
--     returns 409 with reason='tournament_full' once the registered
--     count reaches this number. NULL = no cap (existing behaviour).
--   max_waitlist — when set, the waitlist add endpoint returns 409
--     with reason='waitlist_full' once the queue is at this size.
--
-- One new status on registrations + a position column:
--   status = 'waitlist' indicates a queued entry.
--   waitlist_position holds the queue order (1, 2, 3 …) and is required
--     for waitlist rows / forbidden for everything else (CHECK below).
--
-- A partial unique index keeps the queue compact: every tournament's
-- waitlist rows have distinct positions, but non-waitlist rows aren't
-- constrained. The service is responsible for normalising 1..N (no
-- gaps) on delete + reorder.

ALTER TABLE tournaments
  ADD COLUMN max_participants integer,
  ADD COLUMN max_waitlist integer;

ALTER TABLE registrations
  ADD COLUMN waitlist_position integer;

ALTER TABLE registrations
  DROP CONSTRAINT registration_status_check;

ALTER TABLE registrations
  ADD CONSTRAINT registration_status_check CHECK (
    status IN ('registered', 'checked_in', 'withdrawn', 'disqualified', 'waitlist')
  );

ALTER TABLE registrations
  ADD CONSTRAINT registration_waitlist_position_check CHECK (
    (status = 'waitlist' AND waitlist_position IS NOT NULL AND waitlist_position >= 1)
    OR (status <> 'waitlist' AND waitlist_position IS NULL)
  );

CREATE UNIQUE INDEX registrations_waitlist_position_idx
  ON registrations (tournament_id, waitlist_position)
  WHERE status = 'waitlist';
