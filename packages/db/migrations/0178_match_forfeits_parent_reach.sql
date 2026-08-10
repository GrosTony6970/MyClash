-- 0178_match_forfeits_parent_reach.sql
--
-- Make a cascading pool forfeit reachable — and therefore voidable.
--
-- ## The defect
--
-- A pool forfeit with `canContinue = false` auto-forfeits the fighter's
-- remaining pool matches: one child `match_forfeits` row each, carrying
-- `parent_forfeit_id`, and each child match set to `completed`. Those child
-- MATCH ids were then stored on the parent's `downstream_match_ids`.
--
-- That column has exactly one reader — the started-check that refuses a void
-- once a dependent match has begun — and its started-set includes 'completed'.
-- So the guard fired on the very matches the forfeit itself had just closed,
-- and every cascading pool forfeit was permanently unvoidable. Recording an
-- override instead conflicts (`match_forfeits_one_active_per_match`), so there
-- was no remedy reachable through any product surface.
--
-- The API fix redefines the column honestly: `downstream_match_ids` holds
-- matches that DEPEND on this result, and a pool match feeds no bracket slot,
-- so a pool forfeit has none. The children are EFFECTS of the forfeit, reached
-- through `parent_forfeit_id` and cascade-voided with the parent. That is the
-- same correction already made on the bracket side, where the column used to
-- hold the match's own id.
--
-- ## 1. Backfill
--
-- The code change fixes the writer. Rows already recorded keep their populated
-- list, and the void reads the STORED value — so without this every cascade
-- recorded before this deploy stays permanently unvoidable. Scoped to parents
-- that actually have children, so no other row is touched.
--
-- ## 2. Index
--
-- `parent_forfeit_id` has never had an index. 0091 added a partial index on
-- `tournament_id WHERE parent_forfeit_id IS NULL` whose comment claims
-- "sub-forfeits are reached via the new FK below" — but an FK is not an index,
-- and until now nothing in the codebase traversed it at all. The cascade void
-- is its first reader. Sparse, so partial, matching 0080's style.

BEGIN;

UPDATE match_forfeits AS p
   SET downstream_match_ids = '[]'::jsonb,
       updated_at = now()
 WHERE p.voided_at IS NULL
   AND p.downstream_match_ids <> '[]'::jsonb
   AND EXISTS (
     SELECT 1 FROM match_forfeits AS c WHERE c.parent_forfeit_id = p.id
   );

CREATE INDEX IF NOT EXISTS match_forfeits_parent_forfeit_id_idx
  ON match_forfeits (parent_forfeit_id)
  WHERE parent_forfeit_id IS NOT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
