-- 0043_deletion_requests.sql
-- Polymorphic deletion requests for events and tournaments. Super-admin reviewed.

CREATE TABLE IF NOT EXISTS deletion_requests (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type            text NOT NULL CHECK (target_type IN ('event','tournament')),
  target_id              uuid NOT NULL,
  organization_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requester_user_id      uuid NOT NULL,
  reason                 text NOT NULL,
  status                 text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','approved','rejected','cancelled')),
  reviewed_by_user_id    uuid,
  reviewed_at            timestamptz,
  rejection_reason       text,
  approved_executed_at   timestamptz,
  created_at             timestamptz NOT NULL DEFAULT NOW(),
  updated_at             timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_status ON deletion_requests(status);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_target ON deletion_requests(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_org    ON deletion_requests(organization_id);

-- Only one pending request per target at any time (race-safe).
CREATE UNIQUE INDEX IF NOT EXISTS idx_deletion_requests_one_pending
  ON deletion_requests(target_type, target_id)
  WHERE status = 'pending';

ALTER TABLE deletion_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deletion_requests_select" ON deletion_requests FOR SELECT
  USING (
    is_super_admin()
    OR requester_user_id = auth.uid()
    OR is_org_member(organization_id)
  );

CREATE POLICY "deletion_requests_insert" ON deletion_requests FOR INSERT
  WITH CHECK (
    has_org_role(organization_id, 'admin')
    AND requester_user_id = auth.uid()
  );

CREATE POLICY "deletion_requests_update_review" ON deletion_requests FOR UPDATE
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- Requester (or another org admin) may cancel their own pending request.
CREATE POLICY "deletion_requests_update_cancel" ON deletion_requests FOR UPDATE
  USING (
    status = 'pending'
    AND (requester_user_id = auth.uid() OR has_org_role(organization_id, 'admin'))
  )
  WITH CHECK (status = 'cancelled');
