-- ============================================================
-- MyClash — Directory follows (persistent, event-independent "following")
-- Migration: 0122_directory_follows.sql
-- Dep: 0023_global_persons.sql, 0002_rls.sql (is_super_admin)
--
-- A "directory follow" is a logged-in user's persistent follow of a GLOBAL
-- person, independent of any event. It is the source of truth for the People
-- hub "Following" tab: a followed fighter shows there even when they have no
-- upcoming event. The event-scoped `follows` table stays as-is and continues
-- to drive per-event match/workshop notifications; following a global person
-- upserts a row here AND fans out to `follows` for the notification wiring.
-- Claimed-user only (guests keep the event-scoped follows).
-- ============================================================

CREATE TABLE IF NOT EXISTS directory_follows (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  followed_global_person_id UUID NOT NULL REFERENCES global_persons(id) ON DELETE CASCADE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT directory_follows_user_person_uq UNIQUE (follower_user_id, followed_global_person_id)
);

CREATE INDEX IF NOT EXISTS idx_directory_follows_user
  ON directory_follows (follower_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_directory_follows_person
  ON directory_follows (followed_global_person_id);

-- ── RLS (defense-in-depth; the API uses the service key and enforces the
--        owner in-service) ────────────────────────────────────────────────────
ALTER TABLE directory_follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "directory_follows_owner_all" ON directory_follows
  FOR ALL
  USING (is_super_admin() OR follower_user_id = auth.uid())
  WITH CHECK (is_super_admin() OR follower_user_id = auth.uid());

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- End of 0122_directory_follows.sql
-- ============================================================
