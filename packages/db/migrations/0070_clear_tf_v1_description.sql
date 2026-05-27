-- 0070_clear_tf_v1_description.sql
--
-- Drop the auto-seeded description text on the built-in TF v1 ruleset row
-- so the admin edit form shows an empty description field by default
-- (matching the shape of every other ruleset). Migration 0038 seeded
-- the row with a long explanatory blurb that operators have been asked
-- to remove.
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
