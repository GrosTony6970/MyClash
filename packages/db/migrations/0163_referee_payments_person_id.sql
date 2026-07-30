-- Migration 0163: key referee compensation payments on person_id.
--
-- `referee_compensation_payments.user_id` was the last place in referee-land
-- still keyed on a Supabase auth user. Migration 0063 collapsed the referee
-- dual-identity everywhere else — "Treating user_id as a derived attribute, not
-- a key" — and this table was missed, which produced a silent data-loss bug:
--
--   `computeReport` returns one row per PERSON and labels it
--   `userId: claimed_by_user_id ?? person_id`, but built its payment lookup
--   only from claimed users. The admin UI renders a "paid" checkbox on every
--   row and posts whatever id the report gave it. For an UNCLAIMED referee —
--   which is nearly every referee at a real event, since they are roster people
--   with no MyClash account — that wrote a row keyed by a global_persons.id
--   into a user_id column, and the report could never read it back. The toggle
--   flipped optimistically in the browser and reverted on the next reload.
--
-- After this migration there is exactly one id space in the column, and it is
-- the same one every other referee table uses.

-- ── Rename ───────────────────────────────────────────────────────────────────
ALTER TABLE referee_compensation_payments RENAME COLUMN user_id TO person_id;
ALTER INDEX IF EXISTS idx_rcpay_user RENAME TO idx_rcpay_person;

-- ── Backfill ─────────────────────────────────────────────────────────────────
-- Rows written for a CLAIMED referee hold an auth uid and must become that
-- person's global_persons.id. Rows written by the bug already hold a
-- global_persons.id and must be left alone — no row can match both, because the
-- two id spaces never overlap.
--
-- The NOT EXISTS guard protects UNIQUE (event_id, person_id): if a person
-- somehow has both a correct row and a legacy uid row for the same event, the
-- correct one wins and the legacy one is dropped below.
UPDATE referee_compensation_payments AS p
SET person_id = gp.id
FROM global_persons AS gp
WHERE gp.claimed_by_user_id = p.person_id
  AND NOT EXISTS (
    SELECT 1
    FROM referee_compensation_payments AS other
    WHERE other.event_id = p.event_id
      AND other.person_id = gp.id
      AND other.id <> p.id
  );

-- Anything still holding a value that is not a known person is a leftover of
-- the old keying (or of the bug writing against a deleted profile). It is
-- unreadable by every code path, so it is noise rather than data.
DELETE FROM referee_compensation_payments AS p
WHERE NOT EXISTS (SELECT 1 FROM global_persons AS gp WHERE gp.id = p.person_id);

-- ── Integrity ────────────────────────────────────────────────────────────────
-- The FK the column never had. ON DELETE CASCADE matches the rest of the
-- person-keyed referee tables: a deleted profile takes its payment rows with it.
ALTER TABLE referee_compensation_payments
  ADD CONSTRAINT referee_compensation_payments_person_id_fkey
  FOREIGN KEY (person_id) REFERENCES global_persons(id) ON DELETE CASCADE;

COMMENT ON COLUMN referee_compensation_payments.person_id IS
  'global_persons.id of the referee being paid. Was user_id (auth uid) before 0163; see that migration for why.';
