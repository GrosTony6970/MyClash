-- 0121_multi_ai_keys.sql
-- Multi-key AI settings for all three scopes (platform / organization / fighter).
--
-- Before: each scope stored exactly ONE key in a singleton row
-- (platform_ai_settings, organization_ai_settings UNIQUE(organization_id),
-- fighter_ai_settings PK global_person_id). Saving overwrote the previous key.
--
-- After: each scope owns a *set* of keys (different providers/models), exactly
-- one marked active (drives that scope's AI tools), each with its own monthly
-- budget cap and month-to-date spend. The settings tables keep only the global
-- ceiling (+ org flags); the fighter settings table is fully replaced.

-- ── 1a. Key tables ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organization_ai_keys (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label              TEXT NOT NULL,
  provider           TEXT NOT NULL CHECK (provider IN ('anthropic','openai','mistral','google')),
  model              TEXT,
  api_key_enc        TEXT NOT NULL,
  api_key_iv         TEXT NOT NULL,
  key_last4          TEXT,
  monthly_budget_eur NUMERIC(10,4),
  is_active          BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_org_ai_keys_org ON organization_ai_keys(organization_id);
-- exactly one active key per org
CREATE UNIQUE INDEX IF NOT EXISTS ux_one_active_org_ai_key
  ON organization_ai_keys(organization_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS platform_ai_keys (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label              TEXT NOT NULL,
  provider           TEXT NOT NULL CHECK (provider IN ('anthropic','openai','mistral','google')),
  model              TEXT,
  api_key_enc        TEXT NOT NULL,
  api_key_iv         TEXT NOT NULL,
  key_last4          TEXT,
  monthly_budget_eur NUMERIC(10,4),
  is_active          BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
-- exactly one active platform key (unique among is_active rows → a single true)
CREATE UNIQUE INDEX IF NOT EXISTS ux_one_active_platform_ai_key
  ON platform_ai_keys(is_active) WHERE is_active;

CREATE TABLE IF NOT EXISTS fighter_ai_keys (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  global_person_id   UUID NOT NULL REFERENCES global_persons(id) ON DELETE CASCADE,
  label              TEXT NOT NULL,
  provider           TEXT NOT NULL CHECK (provider IN ('anthropic','openai','mistral','google')),
  model              TEXT,
  api_key_enc        TEXT NOT NULL,
  api_key_iv         TEXT NOT NULL,
  key_last4          TEXT,
  monthly_budget_eur NUMERIC(10,4),
  is_active          BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fighter_ai_keys_gpid ON fighter_ai_keys(global_person_id);
-- exactly one active key per fighter
CREATE UNIQUE INDEX IF NOT EXISTS ux_one_active_fighter_ai_key
  ON fighter_ai_keys(global_person_id) WHERE is_active;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- org keys: org owner/admin members (mirrors organization_ai_settings)
ALTER TABLE organization_ai_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_ai_keys_read" ON organization_ai_keys FOR SELECT USING (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = (SELECT auth.uid()) AND role IN ('owner','admin')
  )
);
CREATE POLICY "org_ai_keys_write" ON organization_ai_keys FOR ALL USING (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = (SELECT auth.uid()) AND role IN ('owner','admin')
  )
);

-- platform keys: super-admin only
ALTER TABLE platform_ai_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "platform_ai_keys_super_admin" ON platform_ai_keys
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

-- fighter keys: no policies — the encrypted key is never exposed to clients;
-- all access is via the NestJS API service role (like fighter_ai_settings).
ALTER TABLE fighter_ai_keys ENABLE ROW LEVEL SECURITY;

-- ── 1b. Per-key usage attribution ───────────────────────────────────────────
ALTER TABLE ai_usage_log
  ADD COLUMN IF NOT EXISTS organization_ai_key_id UUID
    REFERENCES organization_ai_keys(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ai_usage_log_org_key_idx
  ON ai_usage_log(organization_ai_key_id, called_at);

ALTER TABLE platform_ai_usage_log
  ADD COLUMN IF NOT EXISTS platform_ai_key_id UUID
    REFERENCES platform_ai_keys(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS platform_ai_usage_log_key_idx
  ON platform_ai_usage_log(platform_ai_key_id, created_at);
-- allow the 4th provider on the platform usage log too
ALTER TABLE platform_ai_usage_log DROP CONSTRAINT IF EXISTS platform_ai_usage_log_provider_check;
ALTER TABLE platform_ai_usage_log ADD CONSTRAINT platform_ai_usage_log_provider_check
  CHECK (provider IN ('anthropic','openai','mistral','google'));

-- fighter usage log (fighters had no metering at all before)
CREATE TABLE IF NOT EXISTS fighter_ai_usage_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fighter_ai_key_id UUID REFERENCES fighter_ai_keys(id) ON DELETE SET NULL,
  global_person_id UUID NOT NULL,
  feature          TEXT NOT NULL,
  provider         TEXT,
  model            TEXT,
  input_tokens     INTEGER NOT NULL DEFAULT 0,
  output_tokens    INTEGER NOT NULL DEFAULT 0,
  cost_eur         NUMERIC(10,6) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fighter_ai_usage_log_key_idx
  ON fighter_ai_usage_log(fighter_ai_key_id, created_at);
CREATE INDEX IF NOT EXISTS fighter_ai_usage_log_gpid_idx
  ON fighter_ai_usage_log(global_person_id, created_at);
ALTER TABLE fighter_ai_usage_log ENABLE ROW LEVEL SECURITY;

-- ── 1c. Data migration: copy each singleton key → its new table (active) ─────
INSERT INTO organization_ai_keys (organization_id, label, provider, model, api_key_enc, api_key_iv, is_active)
SELECT organization_id, 'Migrated key', provider, model, api_key_enc, api_key_iv, true
FROM organization_ai_settings
WHERE api_key_enc IS NOT NULL;

INSERT INTO platform_ai_keys (label, provider, model, api_key_enc, api_key_iv, is_active)
SELECT 'Migrated key', provider, model, api_key_enc, api_key_iv, true
FROM platform_ai_settings
WHERE api_key_enc IS NOT NULL;

INSERT INTO fighter_ai_keys (global_person_id, label, provider, model, api_key_enc, api_key_iv, is_active)
SELECT global_person_id, 'Migrated key', provider, model, api_key_enc, api_key_iv, true
FROM fighter_ai_settings
WHERE api_key_enc IS NOT NULL;

-- ── Retire singleton key storage ────────────────────────────────────────────
-- platform_ai_settings / organization_ai_settings keep only the global ceiling
-- (+ org flags). Drop the old NOT NULL key columns FIRST, so the bare config
-- row seeded below is valid on a fresh DB where no row exists yet.
ALTER TABLE platform_ai_settings
  DROP COLUMN IF EXISTS provider,
  DROP COLUMN IF EXISTS api_key_enc,
  DROP COLUMN IF EXISTS api_key_iv,
  DROP COLUMN IF EXISTS model;

ALTER TABLE organization_ai_settings
  DROP COLUMN IF EXISTS provider,
  DROP COLUMN IF EXISTS api_key_enc,
  DROP COLUMN IF EXISTS api_key_iv,
  DROP COLUMN IF EXISTS model;

-- Ensure the platform config row exists for the global ceiling. Runs AFTER the
-- NOT NULL provider/api_key columns are dropped, so a (setting_key)-only row is
-- valid; the remaining columns are the PK, a defaulted updated_at, and nullables.
INSERT INTO platform_ai_settings (setting_key) VALUES ('super_admin')
ON CONFLICT (setting_key) DO NOTHING;

-- fighter_ai_settings was ONLY a key store (no ceiling/flags) → fully replaced.
DROP TABLE IF EXISTS fighter_ai_settings;

-- ── 1d. Atomic "set active" helpers (deactivate others, then activate target;
-- avoids the partial-unique-index race a two-step client toggle would hit) ────
CREATE OR REPLACE FUNCTION set_active_platform_ai_key(p_key uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE platform_ai_keys SET is_active = false WHERE is_active AND id <> p_key;
  UPDATE platform_ai_keys SET is_active = true, updated_at = now() WHERE id = p_key;
END;
$$;

CREATE OR REPLACE FUNCTION set_active_org_ai_key(p_org uuid, p_key uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE organization_ai_keys SET is_active = false
    WHERE organization_id = p_org AND is_active AND id <> p_key;
  UPDATE organization_ai_keys SET is_active = true, updated_at = now()
    WHERE id = p_key AND organization_id = p_org;
END;
$$;

CREATE OR REPLACE FUNCTION set_active_fighter_ai_key(p_gpid uuid, p_key uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE fighter_ai_keys SET is_active = false
    WHERE global_person_id = p_gpid AND is_active AND id <> p_key;
  UPDATE fighter_ai_keys SET is_active = true, updated_at = now()
    WHERE id = p_key AND global_person_id = p_gpid;
END;
$$;
