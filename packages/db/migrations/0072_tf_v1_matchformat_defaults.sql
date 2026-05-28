-- 0072_tf_v1_matchformat_defaults.sql
--
-- The seed for the TF_v1 system ruleset in migration 0053 wrote a
-- matchFormat override (pointCap 5, time 180s, softClock 0,
-- maxDoubleHits null) that's the pre-2026 federal format, not the
-- current FFAMHE baseline. The static schema default in
-- packages/rulesets/src/match-format.ts always was the current
-- baseline (10 / 90 / 5 / 4); the stored override silently replaced
-- it for every TF v1 tournament because resolveRulesetConfigDefaults
-- deep-merges tf_config over the static defaults.
--
-- Realign the stored matchFormat with the schema baseline so a fresh
-- TF v1 tournament inherits 10 / 90-90-90 / 5 / 4. Existing
-- tournaments keep whatever they pinned at creation time
-- (ruleset_config_json is captured then; we don't touch snapshots).
--
-- jsonb_set(..., true) makes this idempotent if tf_config was ever
-- reset to NULL or {} between 0053 and now.

BEGIN;

UPDATE custom_rulesets
SET tf_config = jsonb_set(
      COALESCE(tf_config, '{}'::jsonb),
      '{matchFormat}',
      '{
        "pointCap": 10,
        "scoringDirection": "normal",
        "timerMode": "countdown",
        "timeLimitsSeconds": { "pool": 90, "bracket": 90, "finals": 90 },
        "softClockLimitSeconds": 5,
        "maxDoubleHits": 4,
        "maxDoubleHitOutcome": "double_loss_zero_scores"
      }'::jsonb,
      true
    ),
    updated_at = NOW()
WHERE code = 'TF_v1';

COMMIT;
