-- Drop the wall-clock TTL on vaulted temp passwords. Operators kept
-- hitting "Locked — temp password expired" whenever the user they
-- created didn't take delivery of their account within 7 days (slow
-- rollout, vacation, forgotten onboarding) — even though the user
-- hadn't changed their password yet.
--
-- After this migration the only ways a temp password gets locked
-- are:
--   • The user changes their Supabase auth password (detected by
--     supabase_updated_at advancing on reveal).
--   • The super admin explicitly hits DELETE
--     /admin/users/:id/temp-password.
--
-- 7-day TTL → action-driven gate only.

ALTER TABLE admin_user_temp_passwords DROP COLUMN expires_at;
