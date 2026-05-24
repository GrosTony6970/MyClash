-- Migration 0055: organizer-authored scoring rulesets + submission-for-public-sharing.
--
-- Before this migration custom_rulesets was super-admin-only: every row was
-- effectively platform-wide (no `owner_organization_id`), `UNIQUE(code)`
-- enforced single-namespace codes, and there was no concept of a row being
-- "submitted for review for platform-wide sharing".
--
-- After this migration:
--   - An organizer can create a scoring ruleset on their org's behalf
--     (owner_organization_id = org id) and use it on their own tournaments
--     immediately, no approval required.
--   - The organizer can then submit it for review by setting
--     submitted_for_review_at = NOW().
--   - A super-admin reviews the submission and either:
--       - Approves for public sharing → public_visibility = TRUE so the
--         ruleset surfaces in the catalog for every other organisation.
--       - Rejects → rejected_reason is set; the row stays org-scoped so the
--         org can fix the issue and resubmit.
--
-- The UNIQUE(code) constraint is too narrow now (two orgs could clash on
-- the same code). We drop it and replace with a composite unique index
-- over (code, version, owner_organization_id), treating NULL owners as
-- equal via COALESCE — so platform-level codes stay globally unique while
-- org-scoped codes are unique-per-org.

ALTER TABLE custom_rulesets
  ADD COLUMN IF NOT EXISTS owner_organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS public_visibility       BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS submitted_for_review_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS rejected_reason         TEXT        NULL;

ALTER TABLE custom_rulesets DROP CONSTRAINT IF EXISTS custom_rulesets_code_key;

-- NULL owners are coerced to '' for index purposes so multiple platform
-- rows can't share a (code, version) pair while different orgs can.
CREATE UNIQUE INDEX IF NOT EXISTS custom_rulesets_scope_unique_idx
  ON custom_rulesets (code, version, COALESCE(owner_organization_id::text, ''));

CREATE INDEX IF NOT EXISTS custom_rulesets_owner_idx
  ON custom_rulesets (owner_organization_id)
  WHERE owner_organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS custom_rulesets_submitted_idx
  ON custom_rulesets (submitted_for_review_at)
  WHERE submitted_for_review_at IS NOT NULL;

-- RLS: org-admins can SELECT/INSERT/UPDATE/DELETE their own org's rows.
-- Super-admin policy from 0038 still wins for everything else; the
-- application layer also enforces these via service-role writes.
DROP POLICY IF EXISTS "custom_rulesets_org_owner_manage" ON custom_rulesets;
CREATE POLICY "custom_rulesets_org_owner_manage" ON custom_rulesets
  FOR ALL
  USING (
    owner_organization_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = custom_rulesets.owner_organization_id
        AND om.user_id = (SELECT auth.uid())
        AND om.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    owner_organization_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = custom_rulesets.owner_organization_id
        AND om.user_id = (SELECT auth.uid())
        AND om.role IN ('owner', 'admin')
    )
  );

-- Anyone authenticated can SELECT public + system rows (the catalog).
DROP POLICY IF EXISTS "custom_rulesets_public_read" ON custom_rulesets;
CREATE POLICY "custom_rulesets_public_read" ON custom_rulesets
  FOR SELECT
  USING (
    is_system = TRUE
    OR public_visibility = TRUE
  );
