-- 0075_global_profile_linking.sql
--
-- Foundations for the global-profile linking feature set:
--
--   1. global_persons.email — optional, case-insensitive unique among
--      active (non-merged) rows. Powers silent autolink on login and
--      the magic-link self-service claim flow.
--
--   2. global_person_claim_tokens — short-lived one-time tokens issued
--      when a logged-in user requests to claim a global profile via the
--      /me search UI. The link is mailed to global_persons.email; the
--      click finalizes the claim.
--
--   3. global_person_claim_requests — pending approval requests for the
--      organizer-approval queue, used when a profile has no email on
--      file (or auth-email mismatches and the user falls through to
--      manual review). Decisions are kept as history.
--
-- See plans/schedule-in-the-schedule-immutable-cake.md (sections 1, 3e,
-- 8a) for the design rationale.

BEGIN;

-- §1: email column on global_persons + partial unique index.
ALTER TABLE global_persons
  ADD COLUMN IF NOT EXISTS email text;

CREATE UNIQUE INDEX IF NOT EXISTS global_persons_email_lower_idx
  ON global_persons (LOWER(email))
  WHERE email IS NOT NULL AND merged_into_id IS NULL;

-- §3e: one-time tokens for magic-link claim confirmation.
CREATE TABLE IF NOT EXISTS global_person_claim_tokens (
  token            uuid PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  global_person_id uuid NOT NULL REFERENCES global_persons(id) ON DELETE CASCADE,
  expires_at       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS global_person_claim_tokens_expires_idx
  ON global_person_claim_tokens (expires_at);

CREATE INDEX IF NOT EXISTS global_person_claim_tokens_user_idx
  ON global_person_claim_tokens (user_id);

-- §8a: organizer-approval queue for emailless / mismatched claims.
CREATE TABLE IF NOT EXISTS global_person_claim_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  global_person_id    uuid NOT NULL REFERENCES global_persons(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at        timestamptz NOT NULL DEFAULT now(),
  decided_at          timestamptz,
  decided_by_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decision_reason     text
);

-- One pending request per (user, global_person). Decided rows survive
-- as history; the unique index ignores them so a user can resubmit
-- after a rejection (rare, but lets the queue act idempotently).
CREATE UNIQUE INDEX IF NOT EXISTS gpcr_unique_pending_idx
  ON global_person_claim_requests (user_id, global_person_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS gpcr_status_idx
  ON global_person_claim_requests (status);

CREATE INDEX IF NOT EXISTS gpcr_global_person_idx
  ON global_person_claim_requests (global_person_id);

CREATE INDEX IF NOT EXISTS gpcr_user_idx
  ON global_person_claim_requests (user_id);

COMMIT;
