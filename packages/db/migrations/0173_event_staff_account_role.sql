-- 0173_event_staff_account_role.sql
--
-- Re-add `event_staff_accounts.role` — this time as a real authorization gate.
--
-- Migration 0168 dropped a column of the same name five days ago, and said
-- exactly why: the old `role` ('arbitre_table' | 'event_staff') reached no
-- authorization decision anywhere in the API, so it implied a permission
-- boundary that did not exist. It closed with the condition this migration
-- satisfies:
--
--   "Enforcing a genuinely non-scoring staff role is a FEATURE, not this
--    migration"
--
-- That feature is here. The staff app is no longer the scoring pad — it is
-- where every event-day volunteer works — and the three values below name
-- three different jobs, each with its own surfaces:
--
--   scoring   runs a piste with the scoring pad
--   checkin   runs the check-in desk, marking fighters as arrived
--   gear      runs the gear-check table, recording per-weapon equipment passes
--
-- 0168's warning that re-adding this "would silently strip scoring from every
-- account already stored as 'event_staff'" does not apply: the old values were
-- deleted with the old column, and the operator wipes and redeploys the whole
-- stack from these migrations, so there is no installed base to preserve. The
-- DEFAULT below makes that explicit rather than implicit.
--
-- ## Why DEFAULT 'scoring', and why it stays
--
-- A staff account with no stated role has always been a scoring account — that
-- is what the table meant for its entire life before this migration. Keeping
-- the default means the column can go NOT NULL in one statement with no
-- backfill step, and an INSERT that omits the role lands on the historically
-- correct value instead of failing. The API always sends a role explicitly; the
-- default is the safety net, not the path.
--
-- ## Why the CHECK is named
--
-- 0168 noted that DROP COLUMN takes an auto-named CHECK with it "so there is no
-- constraint name to guess here". A future migration that wants to WIDEN this
-- enum has no such luck: it must drop the constraint by name, and an auto-named
-- one (`event_staff_accounts_role_check`) is a guess that fails silently on a
-- wrong spelling — the DROP succeeds as a no-op with IF EXISTS and the old
-- CHECK keeps rejecting the new value. The explicit name below removes the
-- guess.
--
-- ## The role is NOT in the mc_staff token
--
-- The JWT stays `{ sub, event_id, type: 'staff' }`. Every request reads the
-- role from this column instead, so an organiser fixing a mis-configured
-- volunteer takes effect on that volunteer's next tap rather than at their next
-- login. Staff sessions run to the end of the event day, so a role baked into
-- the token would be stale for the whole event.
--
-- ## No index
--
-- Nothing filters by role in SQL: the admin list already selects a whole
-- event's accounts (`idx_event_staff_accounts_event`) and partitions them in
-- the browser, and the per-request gate reads one account by primary key. An
-- index here would be written and never read.

ALTER TABLE event_staff_accounts
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'scoring';

ALTER TABLE event_staff_accounts
  DROP CONSTRAINT IF EXISTS event_staff_accounts_role_allowed;
ALTER TABLE event_staff_accounts
  ADD CONSTRAINT event_staff_accounts_role_allowed
  CHECK (role IN ('scoring', 'checkin', 'gear'));

COMMENT ON COLUMN event_staff_accounts.role IS
  'Which job this account does: scoring (runs a piste) | checkin (desk) | gear (gear check). Read per request, never from the mc_staff token. Only scoring uses event_staff_lice_assignments.';

NOTIFY pgrst, 'reload schema';
