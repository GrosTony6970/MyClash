-- Migration 0051: extend custom_rulesets with per-ruleset match-format
-- defaults and a configurable double-hit penalty formula.
--
-- match_format_defaults: JSONB matching MatchFormatConfig (pointCap,
-- timerMode, timeLimitsSeconds {pool, bracket, finals}, softClockLimitSeconds,
-- maxDoubleHits, scoringDirection, maxDoubleHitOutcome). Nullable; when null
-- the global DEFAULT_MATCH_FORMAT_CONFIG is used for tournaments.
--
-- double_penalty_formula: TEXT formula expression evaluated against the
-- variable `n` (number of double hits). System rulesets (TF_v1) keep the
-- locked literal 'n*(n-1)/3'. Custom rulesets can set their own; the server
-- validates the expression via a free-string parser before storage.

ALTER TABLE custom_rulesets
  ADD COLUMN IF NOT EXISTS match_format_defaults JSONB,
  ADD COLUMN IF NOT EXISTS double_penalty_formula TEXT;
