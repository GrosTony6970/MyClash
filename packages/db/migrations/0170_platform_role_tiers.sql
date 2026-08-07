-- ============================================================
-- MyClash — Platform role tiers
-- Migration: 0170_platform_role_tiers.sql
-- Dep: 0001_init.sql (platform_roles), 0002_rls.sql (is_super_admin)
--
-- `platform_roles` has held exactly one value since 0001: 'super_admin'.
-- This migration opens it to three tiers — 'super_admin', 'platform_admin',
-- 'platform_viewer' — matching PLATFORM_ROLES in
-- packages/types/src/platform-role.ts.
--
-- Mutual exclusion needs no work: user_id is already the PRIMARY KEY, so a
-- user holds at most one role. Changing a tier is an UPDATE (or an upsert on
-- the PK), which is why the missing UPDATE policy is added below.
--
-- ── This migration deliberately does NOT widen RLS ──────────────────────────
--
-- is_super_admin() is untouched and still means exactly 'super_admin'. It is
-- called ~80 times in 0002_rls.sql and in 24 later migrations, in the USING
-- clauses of INSERT/UPDATE/DELETE policies as well as SELECT — widening it to
-- cover the new tiers would silently grant them writes across the whole
-- schema. Every platform_admin capability is exercised through the API's
-- service-role connection instead, where the tier is enforced by
-- PlatformRoleGuard. A platform_admin holding a raw `authenticated` JWT gains
-- nothing here beyond reading their own platform_roles row.
-- ============================================================

-- ── 1. Constrain the role vocabulary ─────────────────────────────────────────
--
-- Until now `role` was free TEXT. A typo ('platform-admin', 'Admin') produced
-- a row that satisfies no tier and fails no write — invisible until someone
-- wonders why an account has no access. Postgres has no
-- ADD CONSTRAINT IF NOT EXISTS, so guard on pg_constraint (idiom from 0091).
--
-- Every existing row is 'super_admin' (the only writer upserts that literal),
-- so this validates without a NOT VALID / VALIDATE dance.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'platform_roles_role_ck'
  ) THEN
    ALTER TABLE platform_roles
      ADD CONSTRAINT platform_roles_role_ck
      CHECK (role IN ('super_admin', 'platform_admin', 'platform_viewer'));
  END IF;
END $$;

-- ── 2. Drop DEFAULT 'super_admin' ────────────────────────────────────────────
--
-- DO NOT RESTORE THIS DEFAULT. With one possible role it was harmless. With
-- three it fails open: any future INSERT that forgets `role` mints a
-- super-admin. All three writers pass the role explicitly today
-- (apps/api/.../admin-users.service.ts, scripts/bootstrap-super-admin.mjs,
-- scripts/seed-min.ts), and no migration seeds this table, so nothing depends
-- on the default.
ALTER TABLE platform_roles ALTER COLUMN role DROP DEFAULT;

-- ── RLS ──────────────────────────────────────────────────────────────────────

-- Returns true if the current user holds ANY platform role.
--
-- Deliberately separate from is_super_admin() rather than a widening of it —
-- see the header. Used by exactly one policy (platform_roles_select, below);
-- it is not a general-purpose bypass and must not be added to write policies.
CREATE OR REPLACE FUNCTION is_platform_staff()
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    auth.jwt() ->> 'role' = 'super_admin'
    OR
    EXISTS (
      SELECT 1 FROM platform_roles
      WHERE user_id = auth.uid()
    ),
    FALSE
  );
$$;

-- 0002 gave platform_roles SELECT / INSERT / DELETE policies and no UPDATE.
-- That was adequate while the only transitions were grant (insert) and revoke
-- (delete). Moving a user between tiers is an UPDATE, and an upsert on the PK
-- needs both INSERT and UPDATE — without this, a tier change under a
-- non-service-role connection fails silently as a no-op row.
DROP POLICY IF EXISTS "platform_roles_update" ON platform_roles;
CREATE POLICY "platform_roles_update" ON platform_roles FOR UPDATE
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- Platform staff can see the platform roster; everyone else still sees only
-- their own row. This is the sole call site of is_platform_staff().
DROP POLICY IF EXISTS "platform_roles_select" ON platform_roles;
CREATE POLICY "platform_roles_select" ON platform_roles FOR SELECT
  USING (is_platform_staff() OR user_id = auth.uid());

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- End of 0170_platform_role_tiers.sql
-- ============================================================
