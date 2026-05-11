CREATE TABLE platform_ai_settings (
  setting_key        TEXT        PRIMARY KEY DEFAULT 'super_admin' CHECK (setting_key = 'super_admin'),
  provider           TEXT        NOT NULL CHECK (provider IN ('anthropic','openai','mistral')),
  api_key_enc        TEXT        NOT NULL,
  api_key_iv         TEXT        NOT NULL,
  updated_by_user_id UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE platform_ai_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_ai_settings_super_admin"
  ON platform_ai_settings
  FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE TABLE platform_ai_usage_log (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id  UUID          REFERENCES auth.users(id) ON DELETE SET NULL,
  feature        TEXT          NOT NULL,
  provider       TEXT          NOT NULL CHECK (provider IN ('anthropic','openai','mistral')),
  input_tokens   INTEGER       NOT NULL DEFAULT 0,
  output_tokens  INTEGER       NOT NULL DEFAULT 0,
  cost_eur       NUMERIC(10,6) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_platform_ai_usage_feature ON platform_ai_usage_log(feature);
CREATE INDEX idx_platform_ai_usage_actor ON platform_ai_usage_log(actor_user_id);

ALTER TABLE platform_ai_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_ai_usage_super_admin"
  ON platform_ai_usage_log
  FOR SELECT
  USING (is_super_admin());

CREATE TABLE ai_data_quality_scans (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  status           TEXT        NOT NULL CHECK (status IN ('running','completed','failed')),
  candidate_count  INTEGER     NOT NULL DEFAULT 0,
  finding_count    INTEGER     NOT NULL DEFAULT 0,
  error_message    TEXT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ
);

CREATE INDEX idx_ai_data_quality_scans_started ON ai_data_quality_scans(started_at DESC);
CREATE INDEX idx_ai_data_quality_scans_status ON ai_data_quality_scans(status);

ALTER TABLE ai_data_quality_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_data_quality_scans_super_admin"
  ON ai_data_quality_scans
  FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE TABLE ai_data_quality_findings (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id             UUID          REFERENCES ai_data_quality_scans(id) ON DELETE SET NULL,
  finding_type        TEXT          NOT NULL,
  severity            TEXT          NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  confidence          NUMERIC(4,3)  NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  status              TEXT          NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','resolved')),
  entity_ids          JSONB         NOT NULL DEFAULT '{}'::jsonb,
  evidence_json       JSONB         NOT NULL DEFAULT '{}'::jsonb,
  ai_summary          TEXT          NOT NULL,
  recommended_action  TEXT          NOT NULL,
  fingerprint         TEXT          NOT NULL UNIQUE,
  reviewed_by_user_id UUID          REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_data_quality_findings_scan ON ai_data_quality_findings(scan_id);
CREATE INDEX idx_ai_data_quality_findings_status ON ai_data_quality_findings(status);
CREATE INDEX idx_ai_data_quality_findings_type ON ai_data_quality_findings(finding_type);
CREATE INDEX idx_ai_data_quality_findings_severity ON ai_data_quality_findings(severity);

ALTER TABLE ai_data_quality_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_data_quality_findings_super_admin"
  ON ai_data_quality_findings
  FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

