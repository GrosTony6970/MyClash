-- 0213: record whether a global person was made outside a roster (rulings 176, 176a).
--
-- The public may know of a profile known through a public entry. A profile known ONLY through
-- entries hidden from the public (a draft Tournament, a draft or test Event) answers like an
-- unknown one (rulings 171b, 173-175). Ruling 176 keeps a profile that stood on its own before any
-- draft entry: hiding it once an organiser enters it in a draft would flip its public page to a
-- 404, and the flip tells of the draft. It stands on its own when an account claimed it, or when
-- a super admin made it (create, bulk import).
--
-- Nothing recorded that. A HEMA Ratings id does not tell it (ruling 176a): adding "Jane Doe, HEMA
-- id 1234" to a draft Event mints a profile that copies the id the organiser typed
-- (`GlobalPersonResolverService`), and that profile is known through nothing but the draft.
--
-- 1. `global_persons.made_outside_roster` (default false). A super admin's create and bulk import
--    set it true. Every other profile keeps false: one the resolver mints for a roster entry, one a
--    fighter makes from her own roster row (promote). The default fails closed: a new path that
--    forgets the column makes a profile public only through a public entry, never at once.
-- 2. Existing rows: a profile with no roster row is marked as made outside one. It was public
--    already (no entry to hide it). A profile with a roster row answers exactly as before 176.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table, no policy change. `global_persons_select` (0187) lets anyone read the row of a
-- claimed fighter listed in the directory; for such a row the flag decides nothing (a claimed
-- profile stands on its own). The API reads it with the service role.
--
-- A merge keeps the survivor's own flag: `merge_fighters` (0212) does not name the column.
--
-- No IF EXISTS anywhere: a mistyped name must fail the replay, not pass it.

ALTER TABLE global_persons
  ADD COLUMN made_outside_roster BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE global_persons gp
SET made_outside_roster = TRUE
WHERE NOT EXISTS (SELECT 1 FROM persons p WHERE p.global_person_id = gp.id);

NOTIFY pgrst, 'reload schema';
