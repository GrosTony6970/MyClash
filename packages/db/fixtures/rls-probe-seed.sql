-- rls-probe-seed.sql — the rows `scripts/db-rls-probe.mjs` reads as an anonymous visitor.
--
-- The probe runs it as the migrating role (so RLS does not apply to the inserts) inside one
-- transaction it always rolls back: nothing here survives the probe, and a collision fails it
-- loudly rather than being skipped.
--
-- Why these rows. A policy runs per row: an empty table never evaluates its policy, and a loop
-- hides. Each row below makes a policy take a branch that once looped or leaked:
--   - ONE platform role. Most read policies start with `is_super_admin()`, which read
--     `platform_roles`, whose policy called back into it: with this row, every anonymous read
--     errored ("stack depth limit exceeded"), public Events included (fixed by 0201). A probe
--     without it said public reads worked.
--   - a club member, a draft Event and its bout, a private League and a club's private penalty
--     ruleset: each is hidden from anon, and deciding so reads a guarded table.
--   - a draft Tournament under the PUBLISHED Event, with a phase, a bout and a registration: the
--     Event's status alone let anon read that Tournament's row until 0203. And a published
--     Tournament under the draft Event: a public row needs BOTH statuses.
--   - a referee assigned to a piste of the published Event and to a Pool and a bout of its published
--     Tournament (public), to a piste of the draft Event, and to a Pool and a bout of the draft
--     Tournament (hidden): the Event's status alone let anon read those last two until 0204.

-- One account with an address, one without and one with an empty one: `account_emails` (0217)
-- answers the first only. And a bystander with an address that the probe does not ask for: a
-- function that answered every account would hand it out too.
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-4111-8111-111111111111', 'rls-probe-admin@example.test'),
  ('22222222-2222-4222-8222-222222222222', NULL),
  ('44444444-4444-4444-8444-444444444444', 'rls-probe-bystander@example.test'),
  ('55555555-5555-4555-8555-555555555555', '');
INSERT INTO organizations (id, slug, name) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'rls-probe-club', 'RLS Probe Club');
INSERT INTO organization_members (organization_id, user_id, role) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'admin');
INSERT INTO platform_roles (user_id, role) VALUES
  ('22222222-2222-4222-8222-222222222222', 'super_admin');
INSERT INTO events (id, organization_id, slug, name, start_date, end_date, status, event_kind) VALUES
  ('eeeeeeee-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001', 'rls-probe-open',
   'Open', '2026-10-01', '2026-10-01', 'published', 'standard'),
  ('eeeeeeee-0000-4000-8000-00000000000b', 'aaaaaaaa-0000-4000-8000-000000000001', 'rls-probe-draft',
   'Draft', '2026-10-01', '2026-10-01', 'draft', 'standard');
INSERT INTO tournaments (id, event_id, slug, name, status) VALUES
  ('77777777-0000-4000-8000-00000000000a', 'eeeeeeee-0000-4000-8000-00000000000a', 'ls', 'LS', 'published'),
  ('77777777-0000-4000-8000-00000000000b', 'eeeeeeee-0000-4000-8000-00000000000b', 'ls', 'LS', 'draft'),
  ('77777777-0000-4000-8000-00000000000c', 'eeeeeeee-0000-4000-8000-00000000000a', 'ls-draft', 'LS draft',
   'draft'),
  ('77777777-0000-4000-8000-00000000000d', 'eeeeeeee-0000-4000-8000-00000000000b', 'ls-pub', 'LS pub',
   'published');
INSERT INTO phases (id, tournament_id, type) VALUES
  ('99999999-0000-4000-8000-00000000000a', '77777777-0000-4000-8000-00000000000a', 'pool'),
  ('99999999-0000-4000-8000-00000000000b', '77777777-0000-4000-8000-00000000000b', 'pool'),
  ('99999999-0000-4000-8000-00000000000c', '77777777-0000-4000-8000-00000000000c', 'pool');
-- A copy of the rules of each of three Tournaments (0229): read with its Tournament, so the
-- published one's is visible, the draft Event's and the draft Tournament's are hidden. Before the
-- bouts: every bout holds a copy of its own Tournament's rules (0232).
INSERT INTO match_rules (id, tournament_id, ruleset_code, ruleset_version, ruleset_config, scoring_config_json, digest) VALUES
  ('ad000000-0000-4000-8000-00000000000a', '77777777-0000-4000-8000-00000000000a', 'TF_v1', '1.1.0', '{}', '{}',
   'rls-probe-a'),
  ('ad000000-0000-4000-8000-00000000000b', '77777777-0000-4000-8000-00000000000b', 'TF_v1', '1.1.0', '{}', '{}',
   'rls-probe-b'),
  ('ad000000-0000-4000-8000-00000000000c', '77777777-0000-4000-8000-00000000000c', 'TF_v1', '1.1.0', '{}', '{}',
   'rls-probe-c');
INSERT INTO matches (id, phase_id, match_rules_id) VALUES
  ('dddddddd-0000-4000-8000-00000000000a', '99999999-0000-4000-8000-00000000000a',
   'ad000000-0000-4000-8000-00000000000a'),
  ('dddddddd-0000-4000-8000-00000000000b', '99999999-0000-4000-8000-00000000000b',
   'ad000000-0000-4000-8000-00000000000b'),
  ('dddddddd-0000-4000-8000-00000000000c', '99999999-0000-4000-8000-00000000000c',
   'ad000000-0000-4000-8000-00000000000c');
INSERT INTO persons (id, event_id, given_name, family_name) VALUES
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'eeeeeeee-0000-4000-8000-00000000000a', 'Probe', 'Fighter');
INSERT INTO registrations (id, tournament_id, person_id) VALUES
  ('cccccccc-0000-4000-8000-00000000000a', '77777777-0000-4000-8000-00000000000a',
   'bbbbbbbb-0000-4000-8000-00000000000a'),
  ('cccccccc-0000-4000-8000-00000000000c', '77777777-0000-4000-8000-00000000000c',
   'bbbbbbbb-0000-4000-8000-00000000000a');
INSERT INTO pools (id, phase_id, name) VALUES
  ('90010000-0000-4000-8000-00000000000a', '99999999-0000-4000-8000-00000000000a', 'A'),
  ('90010000-0000-4000-8000-00000000000c', '99999999-0000-4000-8000-00000000000c', 'A');
INSERT INTO lices (id, event_id, name) VALUES
  ('11ce0000-0000-4000-8000-00000000000a', 'eeeeeeee-0000-4000-8000-00000000000a', 'Piste 1'),
  ('11ce0000-0000-4000-8000-00000000000b', 'eeeeeeee-0000-4000-8000-00000000000b', 'Piste 1');
INSERT INTO global_persons (id, slug, display_name, given_name, family_name) VALUES
  ('9e000000-0000-4000-8000-00000000000a', 'rls-probe-referee', 'Probe Referee', 'Probe', 'Referee');
INSERT INTO referee_assignments (id, event_id, person_id, scope_type, lice_id, pool_id, match_id) VALUES
  ('4a000000-0000-4000-8000-00000000001a', 'eeeeeeee-0000-4000-8000-00000000000a',
   '9e000000-0000-4000-8000-00000000000a', 'lice', '11ce0000-0000-4000-8000-00000000000a', NULL, NULL),
  ('4a000000-0000-4000-8000-00000000002a', 'eeeeeeee-0000-4000-8000-00000000000a',
   '9e000000-0000-4000-8000-00000000000a', 'pool', NULL, '90010000-0000-4000-8000-00000000000a', NULL),
  ('4a000000-0000-4000-8000-00000000003a', 'eeeeeeee-0000-4000-8000-00000000000a',
   '9e000000-0000-4000-8000-00000000000a', 'match', NULL, NULL, 'dddddddd-0000-4000-8000-00000000000a'),
  ('4a000000-0000-4000-8000-00000000001b', 'eeeeeeee-0000-4000-8000-00000000000b',
   '9e000000-0000-4000-8000-00000000000a', 'lice', '11ce0000-0000-4000-8000-00000000000b', NULL, NULL),
  ('4a000000-0000-4000-8000-00000000002c', 'eeeeeeee-0000-4000-8000-00000000000a',
   '9e000000-0000-4000-8000-00000000000a', 'pool', NULL, '90010000-0000-4000-8000-00000000000c', NULL),
  ('4a000000-0000-4000-8000-00000000003c', 'eeeeeeee-0000-4000-8000-00000000000a',
   '9e000000-0000-4000-8000-00000000000a', 'match', NULL, NULL, 'dddddddd-0000-4000-8000-00000000000c');
INSERT INTO leagues (id, slug, name, season_year, status, public_visibility) VALUES
  ('1eaa0000-0000-4000-8000-00000000000a', 'rls-probe-public', 'Public', 2026, 'published', true),
  ('1eaa0000-0000-4000-8000-00000000000b', 'rls-probe-private', 'Private', 2026, 'draft', false);
-- One row per League table, all of the public League: only the API writes them (0216).
INSERT INTO league_organization_roles (id, league_id, organization_id, role) VALUES
  ('1eab0000-0000-4000-8000-00000000000a', '1eaa0000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001', 'member');
INSERT INTO league_user_roles (id, league_id, user_id, role) VALUES
  ('1eac0000-0000-4000-8000-00000000000a', '1eaa0000-0000-4000-8000-00000000000a', '22222222-2222-4222-8222-222222222222', 'admin');
INSERT INTO league_tournament_links (id, league_id, tournament_id, status, requested_by_user_id) VALUES
  ('1ead0000-0000-4000-8000-00000000000a', '1eaa0000-0000-4000-8000-00000000000a', '77777777-0000-4000-8000-00000000000a', 'approved',
   '11111111-1111-4111-8111-111111111111');
INSERT INTO league_tournament_results
  (id, league_id, tournament_id, event_id, global_person_id, ranking_group_key, final_rank) VALUES
  ('1eae0000-0000-4000-8000-00000000000a', '1eaa0000-0000-4000-8000-00000000000a', '77777777-0000-4000-8000-00000000000a',
   'eeeeeeee-0000-4000-8000-00000000000a', '9e000000-0000-4000-8000-00000000000a', 'longsword', 1);
INSERT INTO league_rankings (id, league_id, ranking_group_key, global_person_id, rank) VALUES
  ('1eaf0000-0000-4000-8000-00000000000a', '1eaa0000-0000-4000-8000-00000000000a', 'longsword', '9e000000-0000-4000-8000-00000000000a', 1);
INSERT INTO fighter_manual_medals (id, global_person_id, competition, year, rank, weapon) VALUES
  ('ed000000-0000-4000-8000-00000000000a', '9e000000-0000-4000-8000-00000000000a', 'Open de Lyon', 2024, 3, 'Longsword');
INSERT INTO penalty_rulesets (id, code, version, name, owner_organization_id, built_in, public_visibility) VALUES
  ('fe000000-0000-4000-8000-00000000000a', 'rls-probe-club', '1', 'Club', 'aaaaaaaa-0000-4000-8000-000000000001',
   false, false);
-- An entry and a published snapshot of the club's penalty ruleset: only the API writes them (0226).
INSERT INTO penalty_ruleset_entries (id, ruleset_id, group_number, ref_number, short_name, description, sanctions) VALUES
  ('fe100000-0000-4000-8000-00000000000a', 'fe000000-0000-4000-8000-00000000000a', 1, 1, 'Probe', 'Probe entry',
   '["warning"]');
INSERT INTO penalty_ruleset_versions
  (id, penalty_ruleset_id, version, name, accumulation_scope, yellow_card_points, red_card_points,
   black_card_points, first_black_card_forfeit, second_black_card_forfeit) VALUES
  ('fe200000-0000-4000-8000-00000000000a', 'fe000000-0000-4000-8000-00000000000a', '1', 'Club', 'match', 0, 1, 0,
   'match', 'tournament');
-- The record of a re-pin of the published Tournament: only the API writes it (0227).
INSERT INTO tournament_ruleset_repins
  (id, event_id, tournament_id, from_code, from_version, to_code, to_version, justification, ranking_compatible) VALUES
  ('7e900000-0000-4000-8000-00000000000a', 'eeeeeeee-0000-4000-8000-00000000000a', '77777777-0000-4000-8000-00000000000a',
   'TF_v1', '1.0.0', 'TF_v1', '1.1.0', 'The 2026-10 end rule applies from today.', true);
-- The club's own scoring ruleset and its published snapshot: only the API writes them (0225).
-- A formula row holds the end decision it was published with (0228); its snapshot copies it.
INSERT INTO custom_rulesets (id, code, version, name, status, owner_organization_id, decision_edition) VALUES
  ('c5000000-0000-4000-8000-00000000000a', 'rls-probe-club-scoring', '1.0.0', 'Club scoring', 'published',
   'aaaaaaaa-0000-4000-8000-000000000001', '2026-10');
INSERT INTO custom_ruleset_versions (id, custom_ruleset_id, version, name, score_formula, constants, tiebreakers, decision_edition) VALUES
  ('c5100000-0000-4000-8000-00000000000a', 'c5000000-0000-4000-8000-00000000000a', '1.0.0', 'Club scoring',
   '{}', '{}', '[]', '2026-10');
