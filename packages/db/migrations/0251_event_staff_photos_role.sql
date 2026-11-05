-- 0251 — The `photos` staff job (Event photos, slice 5b; design "Moderation").
--
-- A staff login with the `photos` job works the Event's photo queue in the staff app: approve and
-- delete. It keeps working on a completed Event, until the Event is archived (ruling 437); every
-- other job is refused once the Event is completed, as before. That rule lives in the API
-- (`StaffService.assertEventOpenFor`), not here.
--
-- The CHECK is dropped BY ITS NAME, the one 0173 gave it. A guessed name would make
-- `DROP CONSTRAINT IF EXISTS` a silent no-op, and the old CHECK would go on refusing `photos` next
-- to the new one.

ALTER TABLE event_staff_accounts
  DROP CONSTRAINT IF EXISTS event_staff_accounts_role_allowed;
ALTER TABLE event_staff_accounts
  ADD CONSTRAINT event_staff_accounts_role_allowed
  CHECK (role IN ('scoring', 'checkin', 'gear', 'photos'));

COMMENT ON COLUMN event_staff_accounts.role IS
  'Which job this account does: scoring (runs a piste) | checkin (desk) | gear (gear check) | photos (moderates the Event''s photos; also on a completed Event, ruling 437). Read per request, never from the mc_staff token. Only scoring uses event_staff_lice_assignments.';

NOTIFY pgrst, 'reload schema';
