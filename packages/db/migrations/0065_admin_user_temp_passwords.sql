-- Migration 0065: super-admin temp password vault.
--
-- When a super-admin creates a user via /admin/users, the API generates
-- a random temp password, hands it to Supabase Auth, AND stores it here
-- so the super-admin can re-reveal it on the user detail page until
-- the user themselves changes the password.
--
-- Lifecycle (enforced in admin-users.service.ts):
--   - INSERT on user-create.
--   - DELETE on reveal IF the Supabase Auth `updated_at` has moved past
--     `supabase_updated_at` (= user changed their password).
--   - DELETE on super-admin "lock now".
--   - DELETE when `expires_at < now()` (7-day safety TTL).
--
-- RLS is enabled with no policies, so only the service-role bypass can
-- read or write. Application code is the only path; PostgREST + anon /
-- authenticated roles are blocked outright.

CREATE TABLE IF NOT EXISTS admin_user_temp_passwords (
  user_id              UUID PRIMARY KEY,
  password             TEXT        NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  supabase_updated_at  TIMESTAMPTZ NOT NULL,
  expires_at           TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days')
);

ALTER TABLE admin_user_temp_passwords ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies — service role bypasses RLS, every other
-- role is locked out.
