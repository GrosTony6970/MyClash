-- 0277: the ops agent's key (the ops agent's design,
-- docs/superpowers/specs/2026-11-18-ops-agent-design.md, section 1).
--
-- The ops agent is Claude, run from Anthropic's cloud, reading the platform's health through a
-- small set of routes (the "agent door"). It proves who it is with one machine key. This table
-- holds that key's sha256, never the key itself: the raw value lives only in the VPS `.env`
-- (`OPS_AGENT_KEY`) and in the cloud task's settings.
--
-- WHAT CHANGES.
--   1. `agent_keys`: one row per key the deploy has seeded. `user_id` is the agent's own account,
--      so a later action can name a real actor in the audit log. `token_hash` is the sha256 hex of
--      the key, unique. `revoked_at` set means the key opens nothing; nothing ever clears it
--      (a revoked key never comes back). `last_used_at` is written by the door's guard.
--   2. No read rule and no write rule: only the API's service role reads and writes it.
--
-- WHAT DOES NOT CHANGE. No existing table, rule or function. Deleting the agent's account takes its
-- keys by cascade; the next deploy seeds them again from `.env`.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- One new table, RLS on, no policy (service role only), no function, no grant (0247 and 0273 leave
-- a new table closed to every web role).

CREATE TABLE IF NOT EXISTS agent_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS agent_keys_user_id_idx ON agent_keys (user_id);

ALTER TABLE agent_keys ENABLE ROW LEVEL SECURITY;
-- No policies: only the service_role (BYPASSRLS) may read/write.
