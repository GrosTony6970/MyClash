-- 0069_league_membership_requests.sql
--
-- Org admins can ask to join a league. Today, the only way an
-- organization becomes a member of a league is via the super-admin
-- directly POSTing /admin/leagues/:id/organization-roles. This
-- migration adds the missing "request to join" workflow: an org
-- admin submits a row here, then super-admins (or league admins)
-- approve/reject through the same review-queue + league-editor
-- surfaces that already exist for tournament-attach requests
-- (Bundle 2).
--
-- The status enum mirrors league_tournament_links for consistency:
-- 'requested' / 'approved' / 'rejected' / 'withdrawn'. Approval is
-- the only path that mutates league_organization_roles; rejection
-- and withdrawal just flip the status so the audit trail survives.

BEGIN;

CREATE TABLE IF NOT EXISTS league_membership_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id            uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requested_role       text NOT NULL DEFAULT 'member',
  status               text NOT NULL DEFAULT 'requested'
                         CHECK (status IN ('requested', 'approved', 'rejected', 'withdrawn')),
  message              text,
  requested_by_user_id uuid REFERENCES auth.users(id),
  requested_at         timestamptz NOT NULL DEFAULT now(),
  reviewed_by_user_id  uuid REFERENCES auth.users(id),
  reviewed_at          timestamptz,
  review_note          text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- One pending request per (league, org). Approved/rejected/withdrawn
-- rows are kept as history; the unique index ignores them so an org
-- can resubmit after a rejection.
CREATE UNIQUE INDEX IF NOT EXISTS league_membership_requests_unique_pending_idx
  ON league_membership_requests (league_id, organization_id)
  WHERE status = 'requested';

CREATE INDEX IF NOT EXISTS league_membership_requests_league_status_idx
  ON league_membership_requests (league_id, status);

CREATE INDEX IF NOT EXISTS league_membership_requests_org_status_idx
  ON league_membership_requests (organization_id, status);

COMMIT;
