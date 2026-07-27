-- ============================================================
-- MyClash — Organisation follows ("follow an organiser")
-- Migration: 0159_organization_follows.sql
-- Dep: 0001_init.sql (organizations), 0002_rls.sql (is_super_admin)
--
-- A logged-in user's persistent follow of an ORGANISER. Where
-- `directory_follows` answers "which fighters do I care about",
-- this answers "whose events do I want to hear about" — the
-- payoff is a notification when that organiser publishes a new
-- event (see 0160).
--
-- Claimed users only, deliberately: unlike the event-scoped
-- `follows` table there is no guest branch here, because the
-- entire point is a push/email notification and that needs an
-- auth identity to deliver to. Same call `directory_follows`
-- made for the same reason.
-- ============================================================

CREATE TABLE IF NOT EXISTS organization_follows (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  followed_organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Per-organiser mute. Shipped in the schema now (cheap today, a
  -- migration later) but with no UI yet — the global
  -- notification_preferences.organizer_updates toggle covers the
  -- current need.
  notify_new_event         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organization_follows_user_org_uq UNIQUE (follower_user_id, followed_organization_id)
);

-- "My followed organisers", newest first.
CREATE INDEX IF NOT EXISTS idx_organization_follows_user
  ON organization_follows (follower_user_id, created_at DESC);
-- Fan-out on publish reads only the un-muted followers, so the
-- index is partial on the same predicate.
CREATE INDEX IF NOT EXISTS idx_organization_follows_org
  ON organization_follows (followed_organization_id)
  WHERE notify_new_event;

-- ── RLS (defense-in-depth; the API uses the service key and enforces the
--        owner in-service) ────────────────────────────────────────────────────
ALTER TABLE organization_follows ENABLE ROW LEVEL SECURITY;

-- Owner-only, with no public read carve-out on purpose: the follower COUNT on
-- /o/[slug] is read through the service key, and a public "who follows this
-- organiser" list would leak the audience.
CREATE POLICY "organization_follows_owner_all" ON organization_follows
  FOR ALL
  USING (is_super_admin() OR follower_user_id = auth.uid())
  WITH CHECK (is_super_admin() OR follower_user_id = auth.uid());

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- End of 0159_organization_follows.sql
-- ============================================================
