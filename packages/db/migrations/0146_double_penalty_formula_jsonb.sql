-- Migration 0146: double_penalty_formula becomes JSONB (key OR authored AST).
--
-- 0051 stored it as TEXT — a whitelist key like 'n*(n-1)/3'. It has become a
-- NAMED sub-formula a custom ruleset's score formula references through the
-- `doublePenalty` variable (see FormulaConfig): so it now needs to hold either
-- a key OR an authored FormulaNode AST, which TEXT cannot. The engine already
-- reads and evaluates it; this widens the store to match.
--
-- The conversion is total and value-preserving: to_jsonb() turns each existing
-- key string into the same string as a JSON scalar ("n*(n-1)/3"), which is a
-- valid DoublePenaltySpec, and leaves NULL as NULL. No row loses meaning.
--
-- Idempotency (replay has no ledger): the ALTER is a no-op once the column is
-- already jsonb — Postgres' `USING` cast still runs, and to_jsonb over a jsonb
-- value is identity, so replaying is safe. Guarded with a type check so replay
-- does not re-cast needlessly, matching the guarded-backfill posture of 0143.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'custom_rulesets'
      AND column_name = 'double_penalty_formula'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE custom_rulesets
      ALTER COLUMN double_penalty_formula TYPE JSONB
      USING to_jsonb(double_penalty_formula);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'custom_ruleset_versions'
      AND column_name = 'double_penalty_formula'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE custom_ruleset_versions
      ALTER COLUMN double_penalty_formula TYPE JSONB
      USING to_jsonb(double_penalty_formula);
  END IF;
END $$;
