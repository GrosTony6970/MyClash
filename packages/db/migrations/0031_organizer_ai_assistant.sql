-- Organizer AI tournament setup assistant drafts.
-- Uses organization BYOK + event AI spend caps; platform/super-admin AI keys are separate.

CREATE TABLE IF NOT EXISTS organizer_ai_assistant_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tournament_id UUID NULL REFERENCES tournaments(id) ON DELETE SET NULL,
  actor_user_id UUID NOT NULL,
  draft_type TEXT NOT NULL CHECK (
    draft_type IN (
      'tournament_config',
      'pool_plan',
      'bracket_plan',
      'schedule_grid',
      'referee_assignments'
    )
  ),
  prompt TEXT NOT NULL,
  summary TEXT NULL,
  proposed_actions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  validation_state JSONB NOT NULL DEFAULT '{"ok":false,"warnings":[]}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'ready', 'failed', 'applied', 'rejected')
  ),
  error TEXT NULL,
  ai_usage_feature TEXT NOT NULL DEFAULT 'organizer_tournament_assistant',
  applied_at TIMESTAMPTZ NULL,
  applied_by_user_id UUID NULL,
  rejected_at TIMESTAMPTZ NULL,
  rejected_by_user_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organizer_ai_assistant_drafts_event_idx
  ON organizer_ai_assistant_drafts(event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS organizer_ai_assistant_drafts_tournament_idx
  ON organizer_ai_assistant_drafts(tournament_id)
  WHERE tournament_id IS NOT NULL;

ALTER TABLE organizer_ai_assistant_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY organizer_ai_assistant_drafts_org_read
  ON organizer_ai_assistant_drafts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM events e
      JOIN organization_members om ON om.organization_id = e.organization_id
      WHERE e.id = organizer_ai_assistant_drafts.event_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
  );

-- Writes go through the NestJS API service role so validation and auditing cannot be bypassed.
