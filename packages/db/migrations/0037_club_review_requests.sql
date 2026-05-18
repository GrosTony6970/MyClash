CREATE TABLE IF NOT EXISTS club_review_requests (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  organization_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  proposed_club_id        UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  requester_user_id       UUID NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'pending',
  linked_existing_club_id UUID REFERENCES clubs(id) ON DELETE SET NULL,
  review_notes            TEXT,
  reviewed_by_user_id     UUID,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT club_review_requests_status_check CHECK (
    status IN ('pending', 'approved', 'linked', 'rejected')
  )
);

CREATE INDEX IF NOT EXISTS club_review_requests_status_created_idx
  ON club_review_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS club_review_requests_event_status_idx
  ON club_review_requests (event_id, status);

CREATE INDEX IF NOT EXISTS club_review_requests_proposed_club_idx
  ON club_review_requests (proposed_club_id);

ALTER TABLE club_review_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY club_review_requests_service_role_all
  ON club_review_requests
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

