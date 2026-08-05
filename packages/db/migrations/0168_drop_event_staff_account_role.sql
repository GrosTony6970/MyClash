-- Migration 0168: drop the dead `role` column on event staff accounts.
--
-- `event_staff_accounts.role` was introduced with the table itself
-- (0018_event_staff_accounts.sql) carrying two values, 'arbitre_table'
-- and 'event_staff', and nothing has ever read it. The organizer could
-- pick a role when creating a local PIN account, but the choice reached
-- no authorization decision anywhere in the API.
--
-- What actually gates a staff account, in full:
--   * a valid mc_staff JWT — payload is { sub, event_id, type: 'staff' },
--     the role was never in the token;
--   * status = 'active';
--   * the match's lice_id appears in the account's
--     event_staff_lice_assignments rows.
-- Match unlock is role-blind too: it branches on the tournament's
-- autoLockEnabled setting, never on who the staff member is.
--
-- So the picker implied a permission boundary that did not exist. With
-- one of the two values deleted the column would be a constant, so the
-- column goes. A staff PIN account remains exactly what it already was:
-- a scoring account scoped by status and piste assignment. No existing
-- account changes behaviour.
--
-- Enforcing a genuinely non-scoring staff role is a FEATURE, not this
-- migration — it would silently strip scoring from every account already
-- stored as 'event_staff'.
--
-- DROP COLUMN takes the auto-named CHECK (role IN (...)) constraint with
-- it, so there is no constraint name to guess here.

ALTER TABLE event_staff_accounts
  DROP COLUMN IF EXISTS role;

NOTIFY pgrst, 'reload schema';
