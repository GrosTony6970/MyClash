-- 0116_organizer_chat.sql
-- Conversational organizer assistant: chat conversations + messages.
-- Write proposals reuse organizer_ai_assistant_drafts (0031) via a new
-- conversation linkage, so the confirm/apply + validation + audit path is shared.
-- All writes go through the NestJS API service role (SELECT-only RLS, mirroring 0031).

CREATE TABLE IF NOT EXISTS organizer_chat_conversations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  organization_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tournament_id      UUID NULL REFERENCES tournaments(id) ON DELETE SET NULL,
  created_by_user_id UUID NOT NULL,
  title              TEXT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organizer_chat_conversations_event_idx
  ON organizer_chat_conversations(event_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS organizer_chat_messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID NOT NULL REFERENCES organizer_chat_conversations(id) ON DELETE CASCADE,
  role              TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content           TEXT NULL,
  tool_calls_json   JSONB NOT NULL DEFAULT '[]'::jsonb,  -- assistant tool_use blocks
  tool_results_json JSONB NOT NULL DEFAULT '[]'::jsonb,  -- read-tool outputs echoed to the model
  proposed_draft_id UUID NULL REFERENCES organizer_ai_assistant_drafts(id) ON DELETE SET NULL,
  cost_eur          NUMERIC(12, 6) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organizer_chat_messages_conv_idx
  ON organizer_chat_messages(conversation_id, created_at);

-- Link existing drafts back to the chat turn that proposed them, and record
-- whether a draft originated from the form flow or the chatbot.
ALTER TABLE organizer_ai_assistant_drafts
  ADD COLUMN IF NOT EXISTS conversation_id UUID NULL
    REFERENCES organizer_chat_conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'form'
    CHECK (source IN ('form', 'chat'));

ALTER TABLE organizer_chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizer_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY organizer_chat_conversations_org_read
  ON organizer_chat_conversations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM organization_members om
      WHERE om.organization_id = organizer_chat_conversations.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
  );

CREATE POLICY organizer_chat_messages_org_read
  ON organizer_chat_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM organizer_chat_conversations c
      JOIN organization_members om ON om.organization_id = c.organization_id
      WHERE c.id = organizer_chat_messages.conversation_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
  );

-- No INSERT/UPDATE/DELETE policies: all writes go through the NestJS API
-- service role so validation and auditing cannot be bypassed.
