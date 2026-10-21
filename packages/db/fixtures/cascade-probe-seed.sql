-- cascade-probe-seed.sql — the rows `scripts/db-cascade-probe.mjs` COMMITS, then deletes (0237).
--
-- Unlike the RLS seed, these rows are committed before any delete is tried: Postgres re-checks
-- every key of a row written by the same transaction, so a delete of rows seeded in its own
-- transaction tests something no real delete does. The probe deletes them all at the end, by the
-- club delete it tests, then the referee's profile, which is no club's.
--
-- One club, one Event and one Tournament, with what a played Event holds: a piste, a Pool, two
-- Fighters, the copy of the rules, a bout with a piste, a Pool, both Fighters and a winner, its
-- exchange, a card and a forfeit, a second bout, a referee on the bout, a referee skill two slots
-- list, a compensation plan the Event uses. Every one of the nine keys of 0237 has a row on it.
-- Ids start with `ca5c`, apart from the RLS seed's.

INSERT INTO organizations (id, slug, name) VALUES
  ('ca5c0000-0000-4000-8000-000000000001', 'cascade-probe-club', 'Cascade Probe Club');
INSERT INTO events (id, organization_id, slug, name, start_date, end_date, status, event_kind) VALUES
  ('ca5c0000-0000-4000-8000-0000000000e1', 'ca5c0000-0000-4000-8000-000000000001', 'cascade-probe',
   'Cascade', '2026-10-01', '2026-10-01', 'published', 'standard');
INSERT INTO lices (id, event_id, name) VALUES
  ('ca5c0000-0000-4000-8000-0000000000a1', 'ca5c0000-0000-4000-8000-0000000000e1', 'Piste 1');
INSERT INTO tournaments (id, event_id, slug, name, status) VALUES
  ('ca5c0000-0000-4000-8000-0000000000f1', 'ca5c0000-0000-4000-8000-0000000000e1', 'ls', 'LS',
   'published');
INSERT INTO phases (id, tournament_id, type) VALUES
  ('ca5c0000-0000-4000-8000-0000000000b1', 'ca5c0000-0000-4000-8000-0000000000f1', 'pool');
INSERT INTO pools (id, phase_id, name) VALUES
  ('ca5c0000-0000-4000-8000-0000000000c1', 'ca5c0000-0000-4000-8000-0000000000b1', 'A');
INSERT INTO match_rules (id, tournament_id, ruleset_code, ruleset_version, ruleset_config, scoring_config_json, digest) VALUES
  ('ca5c0000-0000-4000-8000-0000000000d1', 'ca5c0000-0000-4000-8000-0000000000f1', 'TF_v1', '1.1.0',
   '{}', '{}', 'cascade-probe');
INSERT INTO persons (id, event_id, given_name, family_name) VALUES
  ('ca5c0000-0000-4000-8000-000000000101', 'ca5c0000-0000-4000-8000-0000000000e1', 'Red', 'Fighter'),
  ('ca5c0000-0000-4000-8000-000000000102', 'ca5c0000-0000-4000-8000-0000000000e1', 'Blue', 'Fighter');
INSERT INTO registrations (id, tournament_id, person_id) VALUES
  ('ca5c0000-0000-4000-8000-000000000201', 'ca5c0000-0000-4000-8000-0000000000f1',
   'ca5c0000-0000-4000-8000-000000000101'),
  ('ca5c0000-0000-4000-8000-000000000202', 'ca5c0000-0000-4000-8000-0000000000f1',
   'ca5c0000-0000-4000-8000-000000000102');
INSERT INTO matches (id, phase_id, match_rules_id, lice_id, pool_id, red_registration_id,
                     blue_registration_id, winner_registration_id, status) VALUES
  ('ca5c0000-0000-4000-8000-000000000301', 'ca5c0000-0000-4000-8000-0000000000b1',
   'ca5c0000-0000-4000-8000-0000000000d1', 'ca5c0000-0000-4000-8000-0000000000a1',
   'ca5c0000-0000-4000-8000-0000000000c1', 'ca5c0000-0000-4000-8000-000000000201',
   'ca5c0000-0000-4000-8000-000000000202', 'ca5c0000-0000-4000-8000-000000000201', 'completed'),
  ('ca5c0000-0000-4000-8000-000000000302', 'ca5c0000-0000-4000-8000-0000000000b1',
   'ca5c0000-0000-4000-8000-0000000000d1', 'ca5c0000-0000-4000-8000-0000000000a1',
   'ca5c0000-0000-4000-8000-0000000000c1', 'ca5c0000-0000-4000-8000-000000000202',
   'ca5c0000-0000-4000-8000-000000000201', NULL, 'scheduled');
INSERT INTO exchanges (id, client_uuid, match_id, sequence, type, occurred_at) VALUES
  ('ca5c0000-0000-4000-8000-000000000401', 'ca5c0000-0000-4000-8000-000000000411',
   'ca5c0000-0000-4000-8000-000000000301', 1, 'clean', '2026-10-01T10:00:00Z');
INSERT INTO match_penalties (id, client_uuid, match_id, tournament_id, registration_id, sequence, card, occurred_at) VALUES
  ('ca5c0000-0000-4000-8000-000000000501', 'ca5c0000-0000-4000-8000-000000000511',
   'ca5c0000-0000-4000-8000-000000000301', 'ca5c0000-0000-4000-8000-0000000000f1',
   'ca5c0000-0000-4000-8000-000000000202', 1, 'yellow', '2026-10-01T10:01:00Z');
INSERT INTO match_forfeits (id, match_id, tournament_id, forfeiting_registration_id, winner_registration_id,
                            reason, score_policy) VALUES
  ('ca5c0000-0000-4000-8000-000000000601', 'ca5c0000-0000-4000-8000-000000000301',
   'ca5c0000-0000-4000-8000-0000000000f1', 'ca5c0000-0000-4000-8000-000000000202',
   'ca5c0000-0000-4000-8000-000000000201', 'injury', 'keep_current');
INSERT INTO global_persons (id, slug, display_name, given_name, family_name) VALUES
  ('ca5c0000-0000-4000-8000-000000000701', 'cascade-probe-referee', 'Probe Referee', 'Probe', 'Referee');
INSERT INTO referee_assignments (id, event_id, person_id, scope_type, match_id) VALUES
  ('ca5c0000-0000-4000-8000-000000000801', 'ca5c0000-0000-4000-8000-0000000000e1',
   'ca5c0000-0000-4000-8000-000000000701', 'match', 'ca5c0000-0000-4000-8000-000000000301');
INSERT INTO referee_skills (id, name, event_id, is_system) VALUES
  ('cascade-probe-skill', 'Probe skill', 'ca5c0000-0000-4000-8000-0000000000e1', false);
INSERT INTO tournament_slot_config (id, tournament_id, phase_type, slot_index) VALUES
  ('ca5c0000-0000-4000-8000-000000000901', 'ca5c0000-0000-4000-8000-0000000000f1', 'pool', 1);
INSERT INTO tournament_slot_allowed_skills (slot_config_id, skill_id) VALUES
  ('ca5c0000-0000-4000-8000-000000000901', 'cascade-probe-skill');
INSERT INTO event_slot_config_default (id, event_id, phase_type, slot_index) VALUES
  ('ca5c0000-0000-4000-8000-000000000902', 'ca5c0000-0000-4000-8000-0000000000e1', 'pool', 1);
INSERT INTO event_slot_config_default_skills (slot_config_id, skill_id) VALUES
  ('ca5c0000-0000-4000-8000-000000000902', 'cascade-probe-skill');
INSERT INTO referee_compensation_plans (id, name, organization_id) VALUES
  ('ca5c0000-0000-4000-8000-000000000a01', 'Probe plan', 'ca5c0000-0000-4000-8000-000000000001');
INSERT INTO referee_compensation_event_settings (event_id, plan_id) VALUES
  ('ca5c0000-0000-4000-8000-0000000000e1', 'ca5c0000-0000-4000-8000-000000000a01');
