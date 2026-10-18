-- 0225: only the API writes club scoring rulesets (the 0216 pattern).
--
-- THE DEFECT. `custom_rulesets_org_owner_manage` (0055) is FOR ALL: it lets a club's owners and
-- admins write their rows straight through PostgREST, which is public in production. None of these
-- writes lands today: a signed-in caller's policy check loops through the RLS helpers (ruling 111a
-- leaves it latent). This closes the door so that fixing the loop cannot open it: past the API, a
-- direct UPDATE would rewrite a ruleset a running Tournament scores with (its formula, its
-- constants, its status, its version), around the edit guard that freezes a pinned ruleset, and
-- would share a row without the super admin's review (`public_visibility`).
-- `custom_rulesets_super_admin_all` (0038) is FOR ALL too. No app writes either table but through
-- the API's service role: the club screens
-- go through org-custom-rulesets.controller.ts, the super admin's through the admin controller
-- (operator ruling "Club ruleset door", 2026-10-17: close direct writes, as 0216).
--
-- WHAT CHANGES. Both FOR ALL policies become SELECT policies with the same USING, so every read
-- stays as it was; `custom_rulesets_public_read` (0055) stays. The two public roles lose their
-- write grants on `custom_rulesets` and on `custom_ruleset_versions` (RLS on with no policy since
-- 0141), so a stray write fails loudly (42501) instead of touching no row.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table. Reads unchanged; writes from anon and authenticated refused on privilege. The
-- service role (the API) keeps every grant.

-- No IF EXISTS on the two old names: a mistyped one must fail the replay (0216's rule).
drop policy "custom_rulesets_super_admin_all" on custom_rulesets;
drop policy "custom_rulesets_org_owner_manage" on custom_rulesets;
drop policy if exists "custom_rulesets_super_admin_read" on custom_rulesets;
drop policy if exists "custom_rulesets_org_owner_read" on custom_rulesets;

create policy "custom_rulesets_super_admin_read" on custom_rulesets
  for select
  using (is_super_admin());

create policy "custom_rulesets_org_owner_read" on custom_rulesets
  for select
  using (
    owner_organization_id is not null
    and exists (
      select 1 from organization_members om
      where om.organization_id = custom_rulesets.owner_organization_id
        and om.user_id = (select auth.uid())
        and om.role in ('owner', 'admin')
    )
  );

revoke insert, update, delete on custom_rulesets, custom_ruleset_versions from anon, authenticated;
