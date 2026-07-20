-- Migration 0145: how a ruleset values an afterblow.
--
-- 0143 let a ruleset declare THAT it has afterblow. This lets it declare what
-- the retaliation is WORTH, which is what makes the referee's button grid
-- derivable instead of hardcoded:
--
--   fixed     the retaliation is always worth afterblow_fixed_value, whatever
--             it landed on  ->  N buttons  (2-1, 1-1)
--   weighted  the retaliation is worth the target it hit
--             ->  the full attacker x defender product  (2-2, 2-1, 1-2, 1-1)
--
-- `fixed` is FFAMHE's rule and it was previously inexpressible, so the pad
-- carried it as the constants 2-1 / 1-1 in DEFAULT_SCORING_CONFIG — values that
-- agreed with TF_v1's targets by coincidence rather than by derivation. Three
-- things say the convention is real rather than an oversight: the published FAL
-- 2026 columns are 1-1 and 2-1 with no 2-2; every afterblow bucket in 0136
-- filters on first_strike_value and afterblow_value is bucketed nowhere; and
-- when 0136 generalised to a value-3 target it generalised the first strike
-- only.
--
-- NULL means "not declared". The resolver reads that as fixed/1 when the
-- ruleset has afterblow at all, so a row written before this migration keeps
-- exactly the two-button pad it has today — nothing doubles at deploy.
--
-- Same idempotency posture as 0143: replay has no ledger, so the CHECKs ride
-- inside ADD COLUMN IF NOT EXISTS and the backfill is guarded, unlike 0072.

ALTER TABLE custom_rulesets
  ADD COLUMN IF NOT EXISTS afterblow_valuation TEXT
    CHECK (afterblow_valuation IS NULL OR afterblow_valuation IN ('fixed', 'weighted')),
  ADD COLUMN IF NOT EXISTS afterblow_fixed_value SMALLINT
    CHECK (afterblow_fixed_value IS NULL OR afterblow_fixed_value BETWEEN 1 AND 10);

-- Mirrored onto the snapshots so a published version round-trips its valuation.
-- Publishing and rolling back must not silently re-grid a pinned tournament's
-- pad — the class of failure custom_ruleset_versions exists to prevent.
ALTER TABLE custom_ruleset_versions
  ADD COLUMN IF NOT EXISTS afterblow_valuation TEXT
    CHECK (afterblow_valuation IS NULL OR afterblow_valuation IN ('fixed', 'weighted')),
  ADD COLUMN IF NOT EXISTS afterblow_fixed_value SMALLINT
    CHECK (afterblow_fixed_value IS NULL OR afterblow_fixed_value BETWEEN 1 AND 10);

-- The 1..10 ceiling is createExchangeSchema's cap on the value a scoring button
-- may carry. Above it the button 400s the exchange POST, and the offline queue
-- treats a 400 as terminal and DROPS the exchange — data loss, not degradation.

BEGIN;

-- TF_v1 is the one row whose valuation is known: flat 1, per the federation's
-- own published results.
UPDATE custom_rulesets
SET afterblow_valuation = 'fixed',
    afterblow_fixed_value = 1,
    updated_at = NOW()
WHERE code = 'TF_v1'
  AND has_afterblow = TRUE
  AND afterblow_valuation IS NULL;

COMMIT;

-- Generic_PointsCap and every org-authored row are left NULL on purpose.
-- Generic has no afterblow at all, and a custom ruleset has never been offered
-- afterblow controls (the UI gates them on rulesetCode === 'TF_v1'), so there
-- is no operator intent to preserve — only a default not to invent.
