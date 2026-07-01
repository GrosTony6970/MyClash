-- 0120_fighter_ai_settings.sql
-- Per-fighter BYOK AI key for Tier 3 fighter performance insights. A fighter
-- brings their OWN provider key (not the org/platform key), so insights run on
-- their own account/cost. Mirrors organization_ai_settings (AES-256-GCM at rest,
-- decrypted only server-side). Keyed by the fighter's cross-event identity
-- (global_persons). Not event/tournament-scoped → no archive-guard entry.

CREATE TABLE IF NOT EXISTS fighter_ai_settings (
  global_person_id UUID PRIMARY KEY REFERENCES global_persons(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL,
  api_key_enc      TEXT NOT NULL,
  api_key_iv       TEXT NOT NULL,
  model            TEXT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE fighter_ai_settings ENABLE ROW LEVEL SECURITY;
-- No policies: the encrypted key is never exposed to clients. All access is via
-- the NestJS API service role (the fighter manages it through /me/ai-settings).
