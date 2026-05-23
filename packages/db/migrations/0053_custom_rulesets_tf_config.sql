-- Migration 0053: TF v1 (system) ruleset becomes editable by super-admin.
--
-- The TF_v1 plugin (packages/rulesets/src/tf_v1) ships hardcoded scoring
-- functions but reads its tunable values (winBonus, targetValues, matchFormat,
-- doublePenaltyFormula, forfeitPolicy) from the per-tournament `ruleset_config`
-- JSONB and falls back to TFv1DefaultConfig when fields are missing. The
-- `tf_config` column below stores super-admin overrides that
-- `resolveRulesetConfigDefaults` merges over the static defaults — so a
-- super-admin can change e.g. winBonus without a code release.
--
-- The seed mirrors TFv1DefaultConfig exactly so resolveRulesetConfigDefaults
-- behavior is identical to the pre-migration path until an override is saved.

ALTER TABLE custom_rulesets ADD COLUMN IF NOT EXISTS tf_config JSONB;

UPDATE custom_rulesets
SET tf_config = '{
  "winBonus": 3,
  "targetValues": { "deepTarget": 2, "shallowTarget": 1 },
  "matchFormat": {
    "pointCap": 5,
    "scoringDirection": "normal",
    "timerMode": "countdown",
    "timeLimitsSeconds": { "pool": 180, "bracket": 180, "finals": 180 },
    "softClockLimitSeconds": 0,
    "maxDoubleHits": null,
    "maxDoubleHitOutcome": "double_loss_zero_scores"
  },
  "doublePenaltyFormula": "n*(n-1)/3",
  "forfeitPolicy": {
    "reasons": {
      "injury":            { "scorePolicy": "keep_current", "lossScore": 0, "opponentScore": 6, "tournamentState": "ask" },
      "voluntary":         { "scorePolicy": "fixed_loss",   "lossScore": 0, "opponentScore": 6, "tournamentState": "ask" },
      "black_card_1":      { "scorePolicy": "fixed_loss",   "lossScore": 0, "opponentScore": 6, "tournamentState": "ask" },
      "black_card_2":      { "scorePolicy": "fixed_loss",   "lossScore": 0, "opponentScore": 6, "tournamentState": "disqualified" },
      "conduct_violation": { "scorePolicy": "fixed_loss",   "lossScore": 0, "opponentScore": 6, "tournamentState": "disqualified" }
    }
  }
}'::jsonb,
    updated_at = NOW()
WHERE code = 'TF_v1' AND tf_config IS NULL;
