-- Migration 0148: a custom ruleset may be a CODED FORK of a system ruleset.
--
-- Phase 1 gave orgs a formula-authoring path (score_formula + AST). It did not
-- give them a way to take the federal TF_v1 format and change one value —
-- winBonus, a target, the double-penalty — without re-authoring its entire
-- ranking as a formula. TF_v1's ranking (score, then wins, doubles, timesHit,
-- seed) is a coded algorithm; re-expressing it as an AST is explicitly ruled
-- out (the DSL cannot carry its tiebreak chain), so a fork that wants TF_v1's
-- MATHS with different PARAMETERS needs to keep pointing at the coded engine.
--
-- base_code lets a non-system row say "resolve me as the coded ruleset
-- `base_code`@`base_version`, but seed tournaments from MY grammar + tf_config
-- overrides." The RulesetResolver short-circuits a row with base_code set
-- straight to registry.get(base_code, base_version) instead of building a
-- FormulaRuleset from its (empty) score_formula. This is the storage half of
-- the "Customise this format" auto-fork: the fork carries TF_v1's algorithm,
-- relabelled as the org's own private ruleset, with the operator's values.
--
-- base_version pins WHICH coded version the fork tracks: a fork of TF_v1@1.0.0
-- must keep resolving to 1.0.0 even if a TF_v1@2.0.0 algorithm later ships —
-- the same freeze principle that stops a published version drifting.
--
-- Both columns are NULL for every row that exists today: system rows resolve
-- through the registry by their own code, and formula rows resolve from their
-- stored AST. NULL base_code = "I am my own algorithm", which is the pre-0148
-- behaviour, so nothing changes at deploy and no backfill is needed.
--
-- Mirrored onto custom_ruleset_versions so a published fork round-trips its
-- base identity: without it, publishing then resolving a frozen fork snapshot
-- would lose base_code and fall through to the empty-AST FormulaRuleset path —
-- the same "an edit changed how a pinned tournament scores" failure class that
-- 0052/0143/0145 mirror their columns to prevent.
--
-- Idempotency (replay has no ledger): ADD COLUMN IF NOT EXISTS only; no
-- backfill to guard, so there is no 0072-style re-stomp risk here.

ALTER TABLE custom_rulesets
  ADD COLUMN IF NOT EXISTS base_code    TEXT,
  ADD COLUMN IF NOT EXISTS base_version TEXT;

ALTER TABLE custom_ruleset_versions
  ADD COLUMN IF NOT EXISTS base_code    TEXT,
  ADD COLUMN IF NOT EXISTS base_version TEXT;

-- Partial index for the resolver's "is this a coded fork?" lookup; most rows
-- have base_code NULL, so index only the forks.
CREATE INDEX IF NOT EXISTS custom_rulesets_base_code_idx
  ON custom_rulesets (base_code)
  WHERE base_code IS NOT NULL;
