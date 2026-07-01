-- 0117_ai_usage_dashboard.sql
-- AI consumption dashboard + multi-level budgets.
-- Adds per-call model/provider attribution + time-series indexes to ai_usage_log,
-- and org + platform monthly budgets alongside the existing per-event cap.

ALTER TABLE ai_usage_log
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS provider TEXT;

CREATE INDEX IF NOT EXISTS ai_usage_log_called_at_idx ON ai_usage_log(called_at);
CREATE INDEX IF NOT EXISTS ai_usage_log_org_called_at_idx
  ON ai_usage_log(organization_id, called_at);
CREATE INDEX IF NOT EXISTS ai_usage_log_org_feature_idx
  ON ai_usage_log(organization_id, feature);

-- Monthly budgets (NULL = unlimited). Org budget gates all of an org's events;
-- platform budget is a global super-admin ceiling. Enforced in
-- AIUsageService.generateWithCap alongside events.ai_spend_cap_eur.
ALTER TABLE organization_ai_settings
  ADD COLUMN IF NOT EXISTS monthly_budget_eur NUMERIC(10, 4) NULL;

ALTER TABLE platform_ai_settings
  ADD COLUMN IF NOT EXISTS monthly_budget_eur NUMERIC(10, 4) NULL;
