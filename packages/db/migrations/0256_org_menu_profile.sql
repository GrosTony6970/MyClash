-- 0256: an organisation's sidebar — Everything, or Workshops only.
--
-- Some clubs run only Workshops and conferences. With 'workshops' the admin sidebar and the Event
-- overview leave out the tournament pages (Competition, Referees, Compensation, Rulesets, Leagues).
-- Hiding does not block: a hidden page still opens from a link. The value list is owned by
-- ORG_MENU_PROFILES in @myclash/types; this CHECK must name the same values.
--
-- organizations already has RLS, and writes go through the API only (0247), so no new policy.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS menu_profile TEXT NOT NULL DEFAULT 'everything';
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_menu_profile_check
  CHECK (menu_profile IN ('everything','workshops')) NOT VALID;
ALTER TABLE public.organizations VALIDATE CONSTRAINT organizations_menu_profile_check;
COMMENT ON COLUMN public.organizations.menu_profile IS
  'Admin sidebar profile: everything (default, every page) or workshops (tournament pages hidden from the sidebar and the Event overview; they still open from a link).';
