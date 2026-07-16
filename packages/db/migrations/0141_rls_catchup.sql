-- Migration 0141: enable RLS on the 18 tables that shipped without it.
--
-- This is a security fix, not a lint fix. The tables below accumulated
-- across 11 migrations (0048 → 0108) and every one of them was reachable
-- by the `anon` role:
--
--   - PostgREST is routed to the public internet at
--     Host(app.${DOMAIN}) && PathPrefix(/rest/v1) with PGRST_DB_ANON_ROLE:
--     anon, behind no auth middleware (infra/docker-compose.prod.yml).
--   - No migration issues a table-level GRANT, so table privileges come
--     from the supabase/postgres image's ALTER DEFAULT PRIVILEGES, which
--     grant anon/authenticated on tables created by the migrating role.
--   - Per 0002_rls.sql, RLS *is* the boundary that scopes anon down to
--     "published events + public children". Without it there is no boundary.
--
-- The sharpest edge: global_person_claim_tokens stores the magic-link claim
-- token as a plaintext `token uuid PRIMARY KEY`. The claim flow's only
-- security property is possession of the victim's mailbox, and an anon
-- SELECT reads the token straight out of the table. (Hashing that token at
-- rest is a separate follow-up; this migration closes the remote read.)
--
-- Shape follows 0065_admin_user_temp_passwords.sql: RLS on, no policies.
-- service_role bypasses RLS, so the NestJS API — the only reader of any of
-- these tables — is unaffected. None of them is in the supabase_realtime
-- publication (0004_realtime.sql publishes only exchanges/matches/
-- match_events), and no view, RPC or browser client touches them, so
-- deny-all costs nothing.

-- 0048_league_groups.sql
ALTER TABLE league_groups ENABLE ROW LEVEL SECURITY;

-- 0052_custom_ruleset_versions.sql
ALTER TABLE custom_ruleset_versions ENABLE ROW LEVEL SECURITY;

-- 0060_staffing_slot_config.sql
ALTER TABLE tournament_slot_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_slot_allowed_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_slot_config_default ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_slot_config_default_skills ENABLE ROW LEVEL SECURITY;

-- 0068_league_scoring_systems.sql
ALTER TABLE league_scoring_systems ENABLE ROW LEVEL SECURITY;

-- 0069_league_membership_requests.sql
ALTER TABLE league_membership_requests ENABLE ROW LEVEL SECURITY;

-- 0075_global_profile_linking.sql
ALTER TABLE global_person_claim_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE global_person_claim_requests ENABLE ROW LEVEL SECURITY;

-- 0077_referee_granular_availability.sql
ALTER TABLE event_referee_tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_referee_days ENABLE ROW LEVEL SECURITY;

-- 0087_league_scoring_systems_versioning.sql
ALTER TABLE league_scoring_system_versions ENABLE ROW LEVEL SECURITY;

-- 0088_venues.sql
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_areas ENABLE ROW LEVEL SECURITY;

-- 0106_venue_lices.sql
ALTER TABLE venue_lices ENABLE ROW LEVEL SECURITY;

-- 0107_event_venues.sql
ALTER TABLE event_venues ENABLE ROW LEVEL SECURITY;

-- 0108_tournament_phase_venues.sql
ALTER TABLE tournament_phase_venues ENABLE ROW LEVEL SECURITY;

-- Intentionally no policies — service role bypasses RLS, every other
-- role is locked out.

NOTIFY pgrst, 'reload schema';
