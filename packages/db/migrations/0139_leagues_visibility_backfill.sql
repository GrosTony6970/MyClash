-- ─────────────────────────────────────────────────────────────────────────────
-- 0139 — leagues: resync public_visibility with status
--
-- Public league reads AND-gate two columns (listPublic / getPublicBySlug /
-- standings): status = 'published' AND public_visibility = true. The intended
-- invariant is public_visibility === (status = 'published'), but it used to be
-- enforced only by convention in the frontend: the two edit pages derived the
-- flag on save, while the /admin/leagues list dropdown PATCHed status alone.
--
-- So publishing from the table left public_visibility = false and the league
-- never went public (and un-publishing there left a stale true). The API now
-- derives the flag server-side in LeaguesService.update(), making it the single
-- writer; this repairs the rows the old list-page path desynced.
--
-- NOTE: this is a live visibility change, not a schema no-op — it puts every
-- already-'published' league on app.myclash.fr. Rows to be touched:
--   SELECT id, slug, status, public_visibility FROM leagues
--   WHERE public_visibility IS DISTINCT FROM (status = 'published');
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE leagues
SET public_visibility = (status = 'published'),
    updated_at = now()
WHERE public_visibility IS DISTINCT FROM (status = 'published');
