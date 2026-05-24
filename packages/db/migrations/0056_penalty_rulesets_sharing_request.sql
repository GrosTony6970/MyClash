-- Migration 0056: penalty-ruleset "submit for sharing" promotion workflow.
--
-- Today an org-owned penalty ruleset is immediately usable on the org's
-- tournaments but invisible to other orgs (`public_visibility` defaults
-- to FALSE on inserts created by organizers).  This migration adds the
-- super-admin review path for promoting one of those rulesets to
-- platform-wide visibility, mirroring the scoring-ruleset flow from
-- migration 0055.
--
-- Workflow:
--   1. Organizer presses "Submit for sharing" → request_status='pending',
--      request_reason=NULL, public_visibility unchanged (still FALSE).
--   2. Super-admin approves → request_status='approved' AND
--      public_visibility=TRUE. Row becomes visible to every org.
--   3. Super-admin rejects → request_status='rejected',
--      request_rejected_reason=<reason>. Org can edit + resubmit later.
--
-- public_visibility itself was already on the table from migration 0016.
-- We only add the request-tracking columns here.

ALTER TABLE penalty_rulesets
  ADD COLUMN IF NOT EXISTS public_visibility_request_status TEXT NULL
    CHECK (
      public_visibility_request_status IS NULL
      OR public_visibility_request_status IN ('pending', 'approved', 'rejected')
    ),
  ADD COLUMN IF NOT EXISTS public_visibility_request_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS public_visibility_requested_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS public_visibility_reviewed_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS penalty_rulesets_pending_sharing_idx
  ON penalty_rulesets (public_visibility_request_status)
  WHERE public_visibility_request_status = 'pending';
