-- 0201: the membership and platform-role checks answer an anonymous reader without reading a table.
--
-- THE DEFECT. Seven SECURITY INVOKER SQL helpers read a table that RLS guards, and on four of
-- those tables the read loops back into a helper:
--  - `is_super_admin` (0002) and `is_platform_staff` (0170) read `platform_roles`, whose SELECT
--    policy calls `is_platform_staff` again;
--  - `is_org_member` and `has_org_role` (0002) and `has_league_org_role` (0015) read
--    `organization_members`, whose SELECT policy calls `is_org_member` again;
--  - `can_manage_penalty_ruleset` (0016) reads `penalty_rulesets`, whose SELECT policy calls it
--    again; `has_league_user_role` (0015) reads `league_user_roles` the same way.
-- Most read policies start with `is_super_admin()`. So as soon as ONE platform role exists, an
-- anonymous read of any table whose policy reaches a helper (public Events and their bouts
-- included) stopped with "stack depth limit exceeded"; without one, a draft Event's row or a
-- club's private ruleset still did (both measured on a PG17 replay, 2026-09-25). The live-update
-- server checks each change against RLS
-- as the anonymous subscriber, so the public live channel carried errors, not rows.
--
-- WHAT CHANGES (operator ruling 111a). Each helper answers `auth.uid() IS NULL` first, before it
-- reads any table: false; for the two platform checks, the JWT-role test they already made; for
-- `can_manage_penalty_ruleset`, `is_super_admin()`. A CASE, not an AND: Postgres does not promise
-- the order of AND's operands; CASE evaluates its branches in order. The signed-in branch is each
-- body unchanged, so a signed-in reader gets exactly the answer (or the error) they got before.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No table and no policy changes. An anonymous reader never matched: every membership read here
-- compares `user_id = auth.uid()`, which is never true for NULL, and the ruleset read only
-- matches through `has_org_role`, which is false for them. So each anonymous answer is the one
-- the helper would have given had it not looped; the error becomes that answer. The
-- signed-in loop is untouched on purpose (ruling 111a): ending it wakes rules that have never run
-- for a signed-in reader through PostgREST, and needs its own review first.

CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN COALESCE(auth.jwt() ->> 'role' = 'super_admin', FALSE)
    ELSE COALESCE(
      auth.jwt() ->> 'role' = 'super_admin'
      OR
      EXISTS (
        SELECT 1 FROM platform_roles
        WHERE user_id = auth.uid()
          AND role = 'super_admin'
      ),
      FALSE
    )
  END;
$$;

CREATE OR REPLACE FUNCTION is_platform_staff()
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN COALESCE(auth.jwt() ->> 'role' = 'super_admin', FALSE)
    ELSE COALESCE(
      auth.jwt() ->> 'role' = 'super_admin'
      OR
      EXISTS (
        SELECT 1 FROM platform_roles
        WHERE user_id = auth.uid()
      ),
      FALSE
    )
  END;
$$;

CREATE OR REPLACE FUNCTION is_org_member(org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN FALSE
    ELSE EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_id = org_id
        AND user_id = auth.uid()
    )
  END;
$$;

CREATE OR REPLACE FUNCTION has_org_role(org_id UUID, min_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN FALSE
    ELSE EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_id = org_id
        AND user_id = auth.uid()
        AND CASE min_role
          WHEN 'read_only'     THEN role IN ('read_only','scorekeeper','referee','workshop_lead','editor','admin','owner')
          WHEN 'scorekeeper'   THEN role IN ('scorekeeper','editor','admin','owner')
          WHEN 'editor'        THEN role IN ('editor','admin','owner')
          WHEN 'admin'         THEN role IN ('admin','owner')
          WHEN 'owner'         THEN role = 'owner'
          ELSE FALSE
        END
    )
  END;
$$;

CREATE OR REPLACE FUNCTION has_league_user_role(target_league_id UUID, min_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN FALSE
    ELSE EXISTS (
      SELECT 1 FROM league_user_roles
      WHERE league_id = target_league_id
        AND user_id = auth.uid()
        AND CASE min_role
          WHEN 'admin' THEN role IN ('admin', 'owner')
          WHEN 'owner' THEN role = 'owner'
          ELSE FALSE
        END
    )
  END;
$$;

CREATE OR REPLACE FUNCTION has_league_org_role(target_league_id UUID, min_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN FALSE
    ELSE EXISTS (
      SELECT 1
      FROM league_organization_roles lor
      JOIN organization_members om ON om.organization_id = lor.organization_id
      WHERE lor.league_id = target_league_id
        AND om.user_id = auth.uid()
        AND CASE min_role
          WHEN 'member' THEN lor.role IN ('member', 'admin', 'owner')
          WHEN 'admin' THEN lor.role IN ('admin', 'owner') AND om.role IN ('admin', 'owner')
          WHEN 'owner' THEN lor.role = 'owner' AND om.role = 'owner'
          ELSE FALSE
        END
    )
  END;
$$;

CREATE OR REPLACE FUNCTION can_manage_penalty_ruleset(target_ruleset_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN is_super_admin()
    ELSE is_super_admin()
      OR EXISTS (
        SELECT 1
        FROM penalty_rulesets pr
        WHERE pr.id = target_ruleset_id
          AND pr.owner_organization_id IS NOT NULL
          AND has_org_role(pr.owner_organization_id, 'admin')
      )
  END;
$$;
