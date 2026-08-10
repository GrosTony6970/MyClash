-- 0179_referee_assignments_scope_cascade.sql
--
-- Resolve a schema that contradicted itself, and with it a live 500 on every
-- delete of a refereed match, pool or piste.
--
-- ## The contradiction
--
-- `referee_assignments` is polymorphic: `scope_type` selects which of
-- (lice_id | pool_id | match_id) carries the target. Migration 0091 added
-- `referee_assignments_scope_check` to enforce that — for `scope_type='match'`,
-- `match_id IS NOT NULL`, and so on for the other two.
--
-- All three FKs were declared `ON DELETE SET NULL` in 0001, years before that
-- CHECK existed. The two rules cannot both hold. Postgres runs a referential
-- SET NULL as a real UPDATE and validates CHECK constraints on it, so deleting
-- the scope target does not "leave a dangling row" — it ABORTS:
--
--   ERROR: new row for relation "referee_assignments" violates check
--          constraint "referee_assignments_scope_check"
--   CONTEXT: SQL statement "UPDATE ONLY "public"."referee_assignments"
--            SET "match_id" = NULL WHERE $1 OPERATOR(pg_catalog.=) "match_id""
--
-- Reproduced on PG17 for all three columns before writing this.
--
-- ## What it broke
--
-- Nine API call sites delete a match, a pool or a lice. Exactly one —
-- `deleteBracketPhase` — clears the assignments first, and its comment gives
-- the wrong reason ("we'd leave dangling rows"), so it dodged the bug without
-- naming it. The other eight raise a raw Postgres check violation the moment
-- any referee has been assigned:
--
--   deletePool · deleteAllPools · regeneratePoolMatches (fires on every pool
--   roster change) · assignments.service ×2 (withdrawing a registration) ·
--   swiss.service (undo last round) · pools deletes ×2 · lices.service
--
-- ## Why CASCADE and not something else
--
-- The CHECK is the domain rule: a match-scoped assignment describes a specific
-- bout, and cannot mean anything once that bout is gone. SET NULL is therefore
-- never a valid outcome, and RESTRICT would only turn the abort into a
-- permanent refusal to delete a refereed pool. CASCADE is the one action that
-- agrees with the constraint already in the schema.
--
-- Deleting the parent is already destructive and operator-initiated; the
-- assignment rows are pure children of it.
--
-- ## The class, bounded
--
-- Swept the whole schema for the same contradiction — every ON DELETE SET NULL
-- FK whose column is named `IS NOT NULL` by a CHECK on the same table:
--
--   SELECT fk.conrelid::regclass, fk.conname, a.attname, ck.conname
--     FROM pg_constraint fk
--     JOIN unnest(fk.conkey) AS k(attnum) ON TRUE
--     JOIN pg_attribute a ON a.attrelid = fk.conrelid AND a.attnum = k.attnum
--     JOIN pg_constraint ck ON ck.conrelid = fk.conrelid AND ck.contype = 'c'
--    WHERE fk.contype = 'f' AND fk.confdeltype = 'n'
--      AND pg_get_constraintdef(ck.oid) ~ (a.attname || ' IS NOT NULL');
--
-- Three rows, all of them these. Re-run it after adding any polymorphic table.

BEGIN;

ALTER TABLE referee_assignments
  DROP CONSTRAINT IF EXISTS referee_assignments_match_id_fkey;
ALTER TABLE referee_assignments
  ADD CONSTRAINT referee_assignments_match_id_fkey
  FOREIGN KEY (match_id) REFERENCES matches (id) ON DELETE CASCADE;

ALTER TABLE referee_assignments
  DROP CONSTRAINT IF EXISTS referee_assignments_pool_id_fkey;
ALTER TABLE referee_assignments
  ADD CONSTRAINT referee_assignments_pool_id_fkey
  FOREIGN KEY (pool_id) REFERENCES pools (id) ON DELETE CASCADE;

ALTER TABLE referee_assignments
  DROP CONSTRAINT IF EXISTS referee_assignments_lice_id_fkey;
ALTER TABLE referee_assignments
  ADD CONSTRAINT referee_assignments_lice_id_fkey
  FOREIGN KEY (lice_id) REFERENCES lices (id) ON DELETE CASCADE;

-- Fail loud rather than silently leaving a SET NULL in place: a DROP that
-- guessed the wrong constraint name is a no-op, and the ADD would then collide
-- rather than correct anything.
DO $$
DECLARE
  wrong_action INT;
BEGIN
  SELECT count(*) INTO wrong_action
    FROM pg_constraint
   WHERE conrelid = 'referee_assignments'::regclass
     AND contype = 'f'
     AND conname IN (
       'referee_assignments_match_id_fkey',
       'referee_assignments_pool_id_fkey',
       'referee_assignments_lice_id_fkey'
     )
     AND confdeltype <> 'c';
  IF wrong_action > 0 THEN
    RAISE EXCEPTION
      'referee_assignments scope FKs still carry a non-CASCADE delete action (% of 3)',
      wrong_action;
  END IF;
END $$;

COMMIT;

COMMENT ON CONSTRAINT referee_assignments_match_id_fkey ON referee_assignments IS
  'CASCADE, not SET NULL: referee_assignments_scope_check requires match_id NOT NULL for scope_type=match, so nulling it aborts the parent delete.';

NOTIFY pgrst, 'reload schema';
