-- 0260: what a Workshop says about its instructor is not readable through the database door
-- (operator ruling 565).
--
-- THE DEFECT, BEFORE IT SHIPS. `workshop_instructors_select` (0002) shows a published Workshop's
-- instructor lines to anyone, and every column of them: the image's default privileges grant anon
-- and authenticated SELECT on the whole table. The policy reads the Workshop's status only, not its
-- Event's, so a published Workshop of a draft or test Event shows its lines too. Until now a line
-- held a name. Slice 2.6b (rulings 556, 558-560) writes a per-Workshop bio, club line and photo of
-- the instructor into `bio`, `affiliation` and `photo_url` — PostgREST would serve them to a
-- stranger while the app hides the Event everywhere.
--
-- WHAT CHANGES. A policy hides rows, never one field, so the table's SELECT grant is split per
-- column for both public roles (as 0205 did for referee_assignments and 0259 for
-- workshop_enrollments), and the three columns are left out. Which rows each role sees is
-- unchanged. The API reads them with the service role; the public sees them through the app's own
-- public read (slice 3.6), which hides draft and test Events.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table, no policy change. anon and authenticated lose SELECT on three columns. Nothing in
-- the apps reads this table as either role (every read is the API's service role), no policy of
-- another table reads these columns, and no live channel subscribes to the table. A read through
-- PostgREST must now NAME its columns: `select=*` expands to every column and is refused whole,
-- 42501 — fails closed.
--
-- TRAP FOR THE NEXT MIGRATION: a column added to workshop_instructors later is readable by neither
-- public role until a GRANT names it. `pnpm db:rls-probe` (PRIVATE_COLUMNS) and
-- packages/db/test/workshop-instructor-details-private.test.ts pin both statements.

REVOKE SELECT ON public.workshop_instructors FROM anon, authenticated;
GRANT SELECT (id, workshop_id, global_person_id, display_name, sort_order)
  ON public.workshop_instructors TO anon, authenticated;
