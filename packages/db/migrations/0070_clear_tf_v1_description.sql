-- 0070_clear_tf_v1_description.sql
--
-- Historical: this cleared the long explanatory blurb 0038 used to seed on the
-- built-in TF v1 row. 0038 now seeds a short description directly, which does
-- NOT match the WHERE below, so on a fresh apply this is a no-op — it is kept
-- only to clear a DB seeded before that edit (with the old blurb).
--
-- Idempotent: the WHERE clause guards on the EXACT original seeded
-- string. Operators who have already replaced the description with
-- their own text are untouched.

BEGIN;

UPDATE custom_rulesets
SET description = NULL,
    updated_at = now()
WHERE code = 'TF_v1'
  AND description = 'Default tournament-de-frappe ruleset. Score = (wins * winBonus + targetPoints) / (timesHit + doublePenalty).';

COMMIT;
