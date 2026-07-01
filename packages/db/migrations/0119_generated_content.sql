-- 0119_generated_content.sql
-- Tier 3 "AI generated content": cached, on-demand AI artifacts (tournament
-- recaps, organizer content drafts, fighter performance insights). One row per
-- (content_type, entity, locale) — regenerate updates in place. Everything is a
-- private draft until explicitly published. All reads/writes go through the
-- NestJS service role (RLS SELECT-restricted, mirroring the organizer_chat_*
-- tables); per-type visibility is enforced in API code.

CREATE TABLE IF NOT EXISTS ai_generated_content (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type          TEXT NOT NULL,          -- fighter_insight | tournament_recap | organizer_content
  entity_type           TEXT NOT NULL,          -- global_person | tournament | event
  entity_id             UUID NOT NULL,
  organization_id       UUID NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id              UUID NULL REFERENCES events(id) ON DELETE CASCADE,
  locale                TEXT NOT NULL,
  content               TEXT NOT NULL,
  model                 TEXT NULL,
  provider              TEXT NULL,
  cost_eur              NUMERIC(12, 6) NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  generated_by_user_id  UUID NULL,
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at          TIMESTAMPTZ NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (content_type, entity_id, locale)
);

CREATE INDEX IF NOT EXISTS ai_generated_content_entity_idx
  ON ai_generated_content (content_type, entity_id, locale);
CREATE INDEX IF NOT EXISTS ai_generated_content_org_idx
  ON ai_generated_content (organization_id);

ALTER TABLE ai_generated_content ENABLE ROW LEVEL SECURITY;
-- No policies: all access is via the NestJS API service role, which enforces
-- per-type visibility (published recaps are public via the tournament payload;
-- drafts + fighter insights are gated in code).
