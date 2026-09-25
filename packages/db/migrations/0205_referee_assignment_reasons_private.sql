-- 0205: the reasons an organiser confirmed over, on a referee assignment, are not public.
--
-- THE DEFECT, BEFORE IT SHIPS. `referee_assignments_select` (0204) shows a public Tournament's
-- assignment rows to anyone, and every column of them: the image's default privileges grant
-- anon and authenticated SELECT on the whole table. W1 (ADR-016) is the first writer of real content in
-- `conflicts_jsonb`: the Discouraged rules the organiser confirmed over, each with a label. One of
-- them, "attends a Workshop at an overlapping time", names the Workshop — and a Workshop enrolment is
-- readable only by the person and the club (`workshop_enrollments` policies, 0002). The API's own
-- public projection never shows this column (events.service.ts); PostgREST would.
--
-- WHAT CHANGES. A policy hides rows, never one field, so the table's SELECT grant is split per
-- column for both public roles and `conflicts_jsonb` is left out. Which rows each role sees is
-- unchanged (0204's policy still decides them), but a read must now NAME its columns: PostgREST's
-- default `select=*` (and a `referee_assignments(*)` embed) expands to every column and is refused
-- whole, 42501 — fails closed. The service role, the only reader in the apps, is untouched.
-- Writes are untouched too: the org-admin write policy (0002) goes with W1.4, not here.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table, no policy change. anon and authenticated lose SELECT on one column. Nothing in the
-- apps reads this table as either role (every read is the API's service role) and no live channel
-- subscribes to it, so no reader breaks. A REVOKE of the one column alone would do nothing while
-- the table-wide grant stands; hence revoke the table-wide SELECT, grant back by name.
--
-- TRAP FOR THE NEXT MIGRATION: a column added to referee_assignments later is readable by neither
-- public role until a GRANT names it. That is the safe default; add it to the GRANT below if the
-- public should see it. `pnpm db:rls-probe` (PRIVATE_COLUMNS) and
-- packages/db/test/referee-assignment-reasons-private.test.ts pin both statements.

REVOKE SELECT ON referee_assignments FROM anon, authenticated;
GRANT SELECT (id, event_id, scope_type, lice_id, pool_id, match_id, role, status,
  auto_assigned, created_at, person_id) ON referee_assignments TO anon, authenticated;
