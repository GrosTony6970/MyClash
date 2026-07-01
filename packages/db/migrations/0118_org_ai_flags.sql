-- 0118_org_ai_flags.sql
-- Per-organization AI feature overrides. The platform kill-switches
-- (disable_ai_features / disable_organizer_chat feature flags) are global; these
-- let an org turn AI or the chatbot OFF for itself independently. Semantics: an
-- org can only further restrict — a global disable always wins, an org override
-- can never re-enable something the platform turned off (enforced in the API:
-- AIUsageService.generateWithCap + OrganizerChatService.assertChatEnabled).
-- NULL/false = follow the global default; true = disabled for this org.
-- Existing RLS on organization_ai_settings covers the new columns.

ALTER TABLE organization_ai_settings
  ADD COLUMN IF NOT EXISTS ai_features_disabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS organizer_chat_disabled BOOLEAN NOT NULL DEFAULT false;
