-- 0067_backfill_platform_org_flag.sql
--
-- Defensive re-seed of `organizations.is_platform = TRUE` for the
-- well-known MyClash HQ slug. Migration 0049 already did this, but
-- some deployments end up with `is_platform=false` either because
-- the row was created post-0049 from a different code path or
-- because the slug was renamed and never re-tagged. The symptom is
-- "MyClash HQ" leaking through the league editor's org picker
-- (which filters by `is_platform=true`).
--
-- Idempotent: only flips rows that are still flagged false.

BEGIN;

UPDATE organizations
SET is_platform = TRUE
WHERE slug = 'myclash-hq'
  AND is_platform IS DISTINCT FROM TRUE;

COMMIT;
