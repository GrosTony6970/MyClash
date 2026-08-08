-- 0174_event_arrivals.sql
--
-- Who has physically turned up, at the EVENT level.
--
-- ## Why this is not registrations.status = 'checked_in'
--
-- That value already exists and is a trap. Every consumer treats it as
-- identical to 'registered' — `phases.service.ts`, `match-forfeits.service.ts`
-- and `broadcast-notifications.service.ts` all filter
-- `.in('status', ['registered', 'checked_in', ...])` — so writing arrival
-- there would change nothing for any reader while quietly overloading a column
-- that means "is this entry live in the draw".
--
-- It is also the wrong GRAIN. `registrations` is per (tournament, person): a
-- fighter entered in longsword and rapier has two rows, and would have to be
-- checked in twice for one walk through the door. Arrival happens once, to a
-- person, at an event.
--
-- ## One row per (event, person), with a state — not an append-only log
--
-- The desk asks exactly one question, constantly: is this person here? A log
-- answers it with "read the latest row per person", which is a window function
-- on the hottest read of the morning and an easy source of two-rows-disagree
-- bugs when two volunteers tap at once. The UNIQUE below makes the answer a
-- single row lookup, and an upsert makes a double-tap idempotent instead of a
-- race.
--
-- Undo is therefore a STATE CHANGE, not a DELETE: `state` flips back to
-- 'absent' and `reversed_by_staff_account_id` / `reversed_at` record who undid
-- it and when. A delete would erase the fact that a mis-tap happened at all,
-- and "who marked Marie present and then unmarked her" is exactly the question
-- asked when a fighter insists they checked in.
--
-- The trade-off is explicit: this keeps the LAST reversal, not every one. A
-- full audit trail of repeated toggling is not worth a window function on the
-- desk's primary read; `audit_log` is where a complete history belongs if it
-- is ever wanted.
--
-- ## via
--
-- 'search' (a volunteer found the name and tapped) or 'qr' (the fighter
-- presented their pass). Recorded because the two paths have very different
-- error modes — a search hit can be the wrong Marie, a QR scan cannot — and
-- after a real event it is the only way to know whether the QR fast lane was
-- worth building.
--
-- ## Informational only
--
-- Nothing in the scoring or scheduling path reads this table, and nothing may.
-- Arrival never gates a match; the referee at the piste is the enforcement.
-- MyClash's job is to let them see the status without asking.

CREATE TABLE IF NOT EXISTS event_arrivals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,

  -- The current answer. 'absent' exists as a stored state rather than as
  -- "no row" so that an undo has somewhere to record its actor.
  state TEXT NOT NULL DEFAULT 'present',

  -- How the arrival was captured.
  via TEXT NOT NULL DEFAULT 'search',

  -- Who marked them present, and when. NULL actor = marked by an organiser
  -- through the admin app rather than by a desk staff account; the column
  -- references event_staff_accounts, and an organiser has no row there.
  marked_by_staff_account_id UUID REFERENCES event_staff_accounts(id) ON DELETE SET NULL,
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Set when state flips back to 'absent'. Kept when it flips forward again, so
  -- the row always shows the most recent correction.
  reversed_by_staff_account_id UUID REFERENCES event_staff_accounts(id) ON DELETE SET NULL,
  reversed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE event_arrivals
  DROP CONSTRAINT IF EXISTS event_arrivals_state_allowed;
ALTER TABLE event_arrivals
  ADD CONSTRAINT event_arrivals_state_allowed
  CHECK (state IN ('present', 'absent'));

ALTER TABLE event_arrivals
  DROP CONSTRAINT IF EXISTS event_arrivals_via_allowed;
ALTER TABLE event_arrivals
  ADD CONSTRAINT event_arrivals_via_allowed
  CHECK (via IN ('search', 'qr'));

-- One row per person per event. This is what makes "is this person here?" a
-- single-row lookup and makes a double-tap an idempotent upsert rather than a
-- race between two volunteers at the same desk.
CREATE UNIQUE INDEX IF NOT EXISTS event_arrivals_event_person_key
  ON event_arrivals(event_id, person_id);

-- The desk's counter and the missing-at-risk list both scan one event filtered
-- by state.
CREATE INDEX IF NOT EXISTS event_arrivals_event_state_idx
  ON event_arrivals(event_id, state);

-- FK index: person_id is how a fighter's own pass resolves their row.
CREATE INDEX IF NOT EXISTS event_arrivals_person_idx
  ON event_arrivals(person_id);

COMMENT ON TABLE event_arrivals IS
  'Who has physically arrived at an event. INFORMATIONAL ONLY - never gates a match. Separate from registrations.status, which is per-tournament and whose checked_in value every consumer treats as identical to registered.';
COMMENT ON COLUMN event_arrivals.state IS
  'present | absent. Undo flips this rather than deleting, so the reversal keeps an actor.';
COMMENT ON COLUMN event_arrivals.via IS
  'search | qr - how the arrival was captured. The two paths have different error modes.';

ALTER TABLE event_arrivals ENABLE ROW LEVEL SECURITY;

-- Without a policy PostgREST exposes `public` as `anon`, and this table joins
-- roster identity to physical presence at a place and time. Org editors only;
-- the desk itself writes through the API's service-role connection with an
-- mc_staff session, which bypasses RLS by design and is gated on the account's
-- `checkin` role instead.
CREATE POLICY "Org editors manage event arrivals"
  ON event_arrivals
  FOR ALL
  USING (
    has_org_role(
      (SELECT organization_id FROM events WHERE events.id = event_arrivals.event_id),
      'editor'
    )
  )
  WITH CHECK (
    has_org_role(
      (SELECT organization_id FROM events WHERE events.id = event_arrivals.event_id),
      'editor'
    )
  );

NOTIFY pgrst, 'reload schema';
