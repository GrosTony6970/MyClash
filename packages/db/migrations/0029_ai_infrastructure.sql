-- AI key storage: one row per org, provider can change
CREATE TABLE organization_ai_settings (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  provider         TEXT        NOT NULL CHECK (provider IN ('anthropic','openai','mistral')),
  api_key_enc      TEXT        NOT NULL,
  api_key_iv       TEXT        NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE organization_ai_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_settings_read" ON organization_ai_settings FOR SELECT USING (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = (SELECT auth.uid()) AND role IN ('owner','admin')
  )
);
CREATE POLICY "ai_settings_write" ON organization_ai_settings FOR ALL USING (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = (SELECT auth.uid()) AND role IN ('owner','admin')
  )
);

-- Usage log: one row per LLM call
CREATE TABLE ai_usage_log (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID          NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  organization_id  UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  feature          TEXT          NOT NULL,
  input_tokens     INTEGER       NOT NULL DEFAULT 0,
  output_tokens    INTEGER       NOT NULL DEFAULT 0,
  cost_eur         NUMERIC(10,6) NOT NULL DEFAULT 0,
  called_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_usage_event ON ai_usage_log(event_id);
CREATE INDEX idx_ai_usage_org   ON ai_usage_log(organization_id);
ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_usage_read" ON ai_usage_log FOR SELECT USING (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = (SELECT auth.uid()) AND role IN ('owner','admin')
  )
);

-- Spend cap on events
ALTER TABLE events ADD COLUMN ai_spend_cap_eur NUMERIC(10,4) DEFAULT NULL;
