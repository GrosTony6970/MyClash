-- 0115_ai_settings_model.sql
-- Persist the selected AI model per key scope (org + platform).
-- NULL = "use the provider's registry default"
-- (see apps/api/src/modules/ai-providers/model-registry.ts).
-- Existing RLS on both tables covers the new column; no policy change needed.

ALTER TABLE organization_ai_settings
  ADD COLUMN IF NOT EXISTS model TEXT;

ALTER TABLE platform_ai_settings
  ADD COLUMN IF NOT EXISTS model TEXT;
