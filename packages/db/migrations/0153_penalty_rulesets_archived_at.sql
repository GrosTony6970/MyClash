-- Migration 0153: soft-archive marker for penalty rulesets.
--
-- Harmonises penalty-ruleset deletion with the scoring custom_rulesets
-- "delist ≠ delete" model (commit 56a53799). A penalty ruleset that a
-- tournament or event still pins must resolve forever: getEffectiveRuleset*
-- reads the LIVE penalty_rulesets row by id, and the pin FK is
-- ON DELETE SET NULL, so a hard delete would silently fall those tournaments
-- back to the built-in ruleset — a sanction-ladder/cost change under already
-- recorded results.
--
-- Before this migration, PenaltiesService.deleteRuleset 409-blocked deleting a
-- referenced ruleset. It now soft-archives instead: archived_at is stamped, the
-- row leaves every Manage list, Discover catalog and pin dropdown
-- (listRulesetsForOrg / listRulesetCatalogForOrg filter archived_at IS NULL),
-- but getRuleset(id) still resolves it for tournaments already pinned to it.
-- Only an unreferenced ruleset is truly deleted.
--
-- No RLS change: penalty_rulesets already has RLS enabled (migration 0016);
-- this only adds a nullable timestamp column, readable under the existing
-- policies.

ALTER TABLE penalty_rulesets
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;
