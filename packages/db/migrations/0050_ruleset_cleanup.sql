-- Migration 0050: ruleset cleanup.
--
-- 1. Rename the TF_v1 row to match the in-code displayName
--    ("TF (Tournois Fédéraux FFAMHE)"). 0038 now seeds this label directly, so
--    this UPDATE is a no-op on a fresh apply — kept only to fix a DB seeded
--    before that edit (the old label was the mis-expansion "Tournoi de Frappe").
-- 2. Migrate any tournament still pointing at the ghost
--    'TF_v1_no_afterblow' code (it has no code plugin) to 'TF_v1'.
-- 3. Drop the ghost ruleset row.
--
-- The afterblowWindowMs field itself is being removed from the in-code
-- schema in the same commit; no data migration is needed for it because
-- it was never consumed by scoring.

UPDATE custom_rulesets
SET name = 'TF v1 (Tournois Fédéraux FFAMHE)',
    updated_at = NOW()
WHERE code = 'TF_v1';

UPDATE tournaments
SET ruleset_code = 'TF_v1',
    updated_at = NOW()
WHERE ruleset_code = 'TF_v1_no_afterblow';

DELETE FROM custom_rulesets WHERE code = 'TF_v1_no_afterblow';
