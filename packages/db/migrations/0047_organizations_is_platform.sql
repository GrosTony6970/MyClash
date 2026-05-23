-- Migration 0047: mark platform-owned organizations.
--
-- Some organizations exist only to host platform/super-admin operations
-- (e.g. the MyClash internal org). They should never appear in league
-- org pickers or other tenant-facing pickers. This flag is opt-in:
-- migration leaves every row false; an operator manually flips the
-- relevant org(s) via UPDATE post-deploy.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS is_platform BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS organizations_is_platform_idx
  ON organizations (is_platform)
  WHERE is_platform = TRUE;
