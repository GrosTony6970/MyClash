-- Migration 0143: named targets, and afterblow as a declared ruleset property.
--
-- Two defects, both of them shaped by TF_v1 having been treated as the model
-- rather than as one instance of it.
--
-- 1. TARGETS. `tf_config.targetValues` holds exactly two anonymous slots,
--    {deepTarget, shallowTarget} -- FFAMHE's convention, not a property of
--    fencing. A federation scoring head/torso/limb cannot express its grammar,
--    and neither can one scoring a single undifferentiated hit. Worse, that
--    column is read ONLY for is_system rows (ruleset-defaults.ts gates on it),
--    so an org-authored ruleset has nowhere to put targets at all. Hence a
--    first-class column rather than more JSONB inside tf_config: the whole
--    point is that every ruleset, not just the built-in, can declare this.
--
-- 2. AFTERBLOW. Whether a ruleset has afterblow was asked as
--    `rulesetCode === 'TF_v1'` in a dozen UI call sites. `has_afterblow` lets a
--    ruleset answer for itself.
--
--    `afterblow_mode` here is a SEED ONLY and must never become a second source
--    of truth. The live value is tournaments.scoring_config_json.afterblowMode,
--    read by every derivation path. Exchanges store RAW button values that are
--    netted at read time, so if any read path preferred this column over the
--    tournament's, editing a ruleset would retroactively rewrite every score
--    ever derived under it. Ruleset seeds the tournament; tournament wins.
--
-- Idempotency matters more than usual here: `pnpm db:migrations:replay` has no
-- ledger, so every statement below runs again on each replay. The CHECK rides
-- along inside ADD COLUMN IF NOT EXISTS (Postgres has no ADD CONSTRAINT IF NOT
-- EXISTS) so it is skipped exactly when the column is, and every backfill is
-- guarded on `targets IS NULL`. The negative precedent is 0072, whose UPDATE
-- has no such guard and re-stomps tf_config.matchFormat on every replay --
-- silently discarding operator edits on a wipe-and-redeploy.

ALTER TABLE custom_rulesets
  ADD COLUMN IF NOT EXISTS targets        JSONB,
  ADD COLUMN IF NOT EXISTS has_afterblow  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS afterblow_mode TEXT
    CHECK (afterblow_mode IS NULL OR afterblow_mode IN ('full', 'deductive'));

-- The same three on the version snapshots, so a published version can
-- round-trip its grammar. Without this, publishing and then rolling back a
-- ruleset would silently reset its targets and afterblow support -- the exact
-- class of "an edit changed how a pinned tournament scores" that 0052 exists
-- to prevent. Existing snapshots are deliberately NOT backfilled: they were
-- published before rulesets could declare a grammar, and NULL reads as
-- "declares nothing", which is what they did.
ALTER TABLE custom_ruleset_versions
  ADD COLUMN IF NOT EXISTS targets        JSONB,
  ADD COLUMN IF NOT EXISTS has_afterblow  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS afterblow_mode TEXT
    CHECK (afterblow_mode IS NULL OR afterblow_mode IN ('full', 'deductive'));

BEGIN;

-- TF_v1: carry the operator's CONFIGURED pair across, not the code defaults.
-- 0053 seeds tf_config.targetValues and a super-admin may since have changed
-- it; reading through tf_config is what makes this migration a genuine
-- promotion of existing state rather than a reset to 2/1.
--
-- This is also what keeps a FRESH database correct without editing 0053.
-- migrate.mjs sha256s each migration and throws on mismatch, so 0053 cannot be
-- rewritten in place -- but on a wipe-and-redeploy 0053 replays first and this
-- reads its output, so the new shape arrives populated either way.
UPDATE custom_rulesets
SET targets = jsonb_build_array(
      jsonb_build_object(
        'name', 'Deep',
        'value', COALESCE((tf_config -> 'targetValues' ->> 'deepTarget')::int, 2)
      ),
      jsonb_build_object(
        'name', 'Shallow',
        'value', COALESCE((tf_config -> 'targetValues' ->> 'shallowTarget')::int, 1)
      )
    ),
    has_afterblow = TRUE,
    afterblow_mode = 'full',
    updated_at = NOW()
WHERE code = 'TF_v1'
  AND targets IS NULL;

-- Generic_PointsCap scores a single undifferentiated hit -- precisely the case
-- the deepTarget/shallowTarget pair could not represent, and the reason
-- `targets` is a list rather than a wider fixed record.
UPDATE custom_rulesets
SET targets = '[{"name": "Hit", "value": 1}]'::jsonb,
    has_afterblow = FALSE,
    afterblow_mode = NULL,
    updated_at = NOW()
WHERE code = 'Generic_PointsCap'
  AND targets IS NULL;

COMMIT;

-- Org-authored rows are deliberately left with targets NULL and
-- has_afterblow FALSE. FALSE is not a guess: the admin UI gates afterblow
-- controls on `rulesetCode === 'TF_v1'`, so a custom ruleset has never been
-- offered them. Defaulting to TRUE would switch a new surface on for every
-- existing ruleset at deploy, changing behaviour nobody asked to change.
-- NULL targets read as "not declared", and the authoring UI fills them in.
