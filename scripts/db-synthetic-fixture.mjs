import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const fixturePath = join(root, 'packages', 'db', 'fixtures', 'phase4_synthetic.sql');
const explainPath = join(root, 'packages', 'db', 'fixtures', 'phase4_explain.sql');

const fixture = `-- Phase 4 synthetic realistic event dataset.
-- Apply only to disposable local/staging databases.

BEGIN;

DELETE FROM organizations WHERE id = '10000000-0000-4000-8000-000000000001';
DELETE FROM clubs WHERE slug LIKE 'phase4-club-%';
DELETE FROM global_persons WHERE slug LIKE 'phase4-fighter-%';

INSERT INTO organizations (id, slug, name, contact_email, status)
VALUES ('10000000-0000-4000-8000-000000000001', 'phase4-org', 'Phase 4 Review Org', 'phase4@example.test', 'active');

INSERT INTO organization_members (organization_id, user_id, role)
VALUES
  ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000010', 'owner'),
  ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000011', 'admin');

INSERT INTO clubs (id, slug, name, city, country_code, unverified)
SELECT
  ('10000000-0000-4000-8000-000000001' || lpad(i::text, 3, '0'))::uuid,
  'phase4-club-' || i,
  'Phase 4 Club ' || i,
  'City ' || i,
  CASE WHEN i % 3 = 0 THEN 'FR' WHEN i % 3 = 1 THEN 'DE' ELSE 'SE' END,
  'false'
FROM generate_series(1, 12) AS i;

INSERT INTO global_persons (id, slug, display_name, given_name, family_name, club_id, country_code, hema_ratings_id)
SELECT
  ('10000000-0000-4000-8000-000000002' || lpad(i::text, 3, '0'))::uuid,
  'phase4-fighter-' || i,
  'Phase4 Fighter ' || i,
  'Phase4',
  'Fighter ' || i,
  ('10000000-0000-4000-8000-000000001' || lpad(((i - 1) % 12 + 1)::text, 3, '0'))::uuid,
  CASE WHEN i % 3 = 0 THEN 'FR' WHEN i % 3 = 1 THEN 'DE' ELSE 'SE' END,
  (6000 + i)::text
FROM generate_series(1, 80) AS i;

INSERT INTO events (id, organization_id, slug, name, location, start_date, end_date, status)
VALUES (
  '10000000-0000-4000-8000-000000000100',
  '10000000-0000-4000-8000-000000000001',
  'phase4-open',
  'Phase 4 Open',
  'Lyon',
  '2026-06-01',
  '2026-06-02',
  'running'
);

INSERT INTO lices (id, event_id, name, sort_order)
SELECT
  ('10000000-0000-4000-8000-00000000020' || i)::uuid,
  '10000000-0000-4000-8000-000000000100',
  'Lice ' || i,
  i - 1
FROM generate_series(1, 4) AS i;

INSERT INTO persons (id, event_id, given_name, family_name, email, club_id, hema_ratings_id, claim_status, claimed_by_user_id, global_person_id)
SELECT
  ('10000000-0000-4000-8000-000000003' || lpad(i::text, 3, '0'))::uuid,
  '10000000-0000-4000-8000-000000000100',
  'Phase4',
  'Fighter ' || i,
  'phase4-fighter-' || i || '@example.test',
  ('10000000-0000-4000-8000-000000001' || lpad(((i - 1) % 12 + 1)::text, 3, '0'))::uuid,
  (6000 + i)::text,
  CASE WHEN i <= 30 THEN 'claimed' ELSE 'unclaimed' END,
  CASE WHEN i <= 30 THEN ('10000000-0000-4000-8000-000000004' || lpad(i::text, 3, '0'))::uuid ELSE NULL END,
  ('10000000-0000-4000-8000-000000002' || lpad(i::text, 3, '0'))::uuid
FROM generate_series(1, 80) AS i;

INSERT INTO notification_preferences (user_id, enabled)
SELECT claimed_by_user_id, true FROM persons
WHERE event_id = '10000000-0000-4000-8000-000000000100' AND claimed_by_user_id IS NOT NULL;

INSERT INTO tournaments (id, event_id, slug, name, weapon, category, ruleset_code, status, sort_order)
VALUES (
  '10000000-0000-4000-8000-000000000300',
  '10000000-0000-4000-8000-000000000100',
  'longsword-open',
  'Longsword Open',
  'Longsword',
  'Open',
  'TF_v1',
  'running',
  1
);

INSERT INTO registrations (id, tournament_id, person_id, fighter_id, seed, status, bib_number)
SELECT
  ('10000000-0000-4000-8000-000000005' || lpad(i::text, 3, '0'))::uuid,
  '10000000-0000-4000-8000-000000000300',
  ('10000000-0000-4000-8000-000000003' || lpad(i::text, 3, '0'))::uuid,
  ('10000000-0000-4000-8000-000000002' || lpad(i::text, 3, '0'))::uuid,
  i,
  'checked_in',
  i
FROM generate_series(1, 80) AS i;

INSERT INTO phases (id, tournament_id, type, sort_order, status, config_json)
VALUES
  ('10000000-0000-4000-8000-000000000400', '10000000-0000-4000-8000-000000000300', 'pool', 1, 'running', '{"visibility_status":"published"}'),
  ('10000000-0000-4000-8000-000000000401', '10000000-0000-4000-8000-000000000300', 'single_elim', 2, 'pending', '{"visibility_status":"hidden"}');

INSERT INTO pools (id, phase_id, name, sort_order)
SELECT
  ('10000000-0000-4000-8000-00000000050' || i)::uuid,
  '10000000-0000-4000-8000-000000000400',
  'Pool ' || chr(64 + i),
  i
FROM generate_series(1, 4) AS i;

INSERT INTO pool_members (pool_id, registration_id, seed)
SELECT
  ('10000000-0000-4000-8000-00000000050' || (((i - 1) % 4) + 1))::uuid,
  ('10000000-0000-4000-8000-000000005' || lpad(i::text, 3, '0'))::uuid,
  i
FROM generate_series(1, 80) AS i;

INSERT INTO bracket_slots (id, phase_id, round, position, registration_a_id, registration_b_id)
SELECT
  ('10000000-0000-4000-8000-000000006' || lpad(i::text, 3, '0'))::uuid,
  '10000000-0000-4000-8000-000000000401',
  1,
  i,
  ('10000000-0000-4000-8000-000000005' || lpad(i::text, 3, '0'))::uuid,
  ('10000000-0000-4000-8000-000000005' || lpad((33 - i)::text, 3, '0'))::uuid
FROM generate_series(1, 16) AS i;

INSERT INTO matches (
  id, phase_id, pool_id, bracket_slot_id, lice_id, red_registration_id, blue_registration_id,
  scheduled_at, started_at, ended_at, duration_active_ms, duration_total_ms,
  red_score, blue_score, winner_registration_id, status, match_number_label
)
SELECT
  ('10000000-0000-4000-8000-000000007' || lpad(i::text, 3, '0'))::uuid,
  CASE WHEN i <= 80 THEN '10000000-0000-4000-8000-000000000400'::uuid ELSE '10000000-0000-4000-8000-000000000401'::uuid END,
  CASE WHEN i <= 80 THEN ('10000000-0000-4000-8000-00000000050' || (((i - 1) % 4) + 1))::uuid ELSE NULL END,
  CASE WHEN i > 80 THEN ('10000000-0000-4000-8000-000000006' || lpad((i - 80)::text, 3, '0'))::uuid ELSE NULL END,
  ('10000000-0000-4000-8000-00000000020' || (((i - 1) % 4) + 1))::uuid,
  ('10000000-0000-4000-8000-000000005' || lpad((((i - 1) % 80) + 1)::text, 3, '0'))::uuid,
  ('10000000-0000-4000-8000-000000005' || lpad(((i % 80) + 1)::text, 3, '0'))::uuid,
  '2026-06-01 09:00:00+00'::timestamptz + (i * interval '5 minutes'),
  CASE WHEN i <= 64 THEN '2026-06-01 09:00:00+00'::timestamptz + (i * interval '5 minutes') ELSE NULL END,
  CASE WHEN i <= 60 THEN '2026-06-01 09:04:00+00'::timestamptz + (i * interval '5 minutes') ELSE NULL END,
  CASE WHEN i <= 60 THEN 240000 ELSE NULL END,
  CASE WHEN i <= 60 THEN 300000 ELSE NULL END,
  CASE WHEN i <= 60 THEN 5 ELSE 0 END,
  CASE WHEN i <= 60 THEN 3 ELSE 0 END,
  CASE WHEN i <= 60 THEN ('10000000-0000-4000-8000-000000005' || lpad((((i - 1) % 80) + 1)::text, 3, '0'))::uuid ELSE NULL END,
  CASE WHEN i <= 60 THEN 'completed' WHEN i <= 64 THEN 'running' ELSE 'scheduled' END,
  'P4-M' || i
FROM generate_series(1, 96) AS i;

INSERT INTO exchanges (client_uuid, match_id, sequence, type, occurred_at, first_striker_color, first_strike_value, afterblow_value, red_score_delta, blue_score_delta)
SELECT
  ('20000000-0000-4000-8000-' || lpad(((m * 10) + e)::text, 12, '0'))::uuid,
  ('10000000-0000-4000-8000-000000007' || lpad(m::text, 3, '0'))::uuid,
  e,
  CASE WHEN e = 3 THEN 'double' WHEN e = 4 THEN 'afterblow' ELSE 'clean' END,
  '2026-06-01 09:00:00+00'::timestamptz + (m * interval '5 minutes') + (e * interval '30 seconds'),
  CASE WHEN e % 2 = 0 THEN 'blue' ELSE 'red' END,
  1,
  CASE WHEN e = 4 THEN 1 ELSE NULL END,
  CASE WHEN e IN (1, 4, 5) THEN 1 ELSE 0 END,
  CASE WHEN e = 2 THEN 1 ELSE 0 END
FROM generate_series(1, 60) AS m
CROSS JOIN generate_series(1, 5) AS e;

INSERT INTO referee_qualifications (user_id, event_id, role, rating, active)
SELECT
  ('10000000-0000-4000-8000-000000004' || lpad(i::text, 3, '0'))::uuid,
  '10000000-0000-4000-8000-000000000100',
  role,
  3 + (i % 3),
  true
FROM generate_series(1, 12) AS i
CROSS JOIN (VALUES ('arbitre_declarant'), ('arbitre_assesseur'), ('arbitre_table')) AS roles(role);

INSERT INTO referee_assignments (event_id, user_id, scope_type, lice_id, pool_id, role, starts_at, ends_at, status, auto_assigned)
SELECT
  '10000000-0000-4000-8000-000000000100',
  ('10000000-0000-4000-8000-000000004' || lpad(i::text, 3, '0'))::uuid,
  'pool',
  ('10000000-0000-4000-8000-00000000020' || (((i - 1) % 4) + 1))::uuid,
  ('10000000-0000-4000-8000-00000000050' || (((i - 1) % 4) + 1))::uuid,
  CASE WHEN i % 3 = 0 THEN 'arbitre_declarant' WHEN i % 3 = 1 THEN 'arbitre_assesseur' ELSE 'arbitre_table' END,
  '2026-06-01 09:00:00+00',
  '2026-06-01 13:00:00+00',
  'assigned',
  true
FROM generate_series(1, 12) AS i;

INSERT INTO workshops (id, event_id, slug, title, status, capacity, duration_minutes)
VALUES ('10000000-0000-4000-8000-000000000600', '10000000-0000-4000-8000-000000000100', 'phase4-workshop', 'Phase 4 Workshop', 'published', 30, 90);

INSERT INTO workshop_sessions (id, workshop_id, starts_at, ends_at, location_label, status)
VALUES ('10000000-0000-4000-8000-000000000601', '10000000-0000-4000-8000-000000000600', '2026-06-01 14:00:00+00', '2026-06-01 15:30:00+00', 'Salle A', 'scheduled');

INSERT INTO workshop_enrollments (workshop_session_id, user_id, status, position)
SELECT '10000000-0000-4000-8000-000000000601', claimed_by_user_id, 'confirmed', row_number() OVER ()
FROM persons
WHERE event_id = '10000000-0000-4000-8000-000000000100' AND claimed_by_user_id IS NOT NULL
LIMIT 20;

INSERT INTO event_programme_blocks (event_id, day_index, sort_order, block_type, label, competition_id, competition_phase, lice_count, start_time, end_time)
VALUES
  ('10000000-0000-4000-8000-000000000100', 0, 1, 'competition', 'Longsword pools', '10000000-0000-4000-8000-000000000300', 'pool', 4, '09:00', '13:00'),
  ('10000000-0000-4000-8000-000000000100', 0, 2, 'workshop', 'Workshop block', NULL, NULL, 1, '14:00', '15:30');

INSERT INTO tournament_query_settings (tournament_id, access_policy, rate_limit_per_hour)
VALUES ('10000000-0000-4000-8000-000000000300', 'organizers_only', 60);

INSERT INTO tournament_query_history (tournament_id, event_id, user_id, question, language, tool_name, summary, cost_eur)
VALUES (
  '10000000-0000-4000-8000-000000000300',
  '10000000-0000-4000-8000-000000000100',
  '10000000-0000-4000-8000-000000000011',
  'Top 5 fighters by win rate',
  'en',
  'rank_fighters',
  'Phase 4 synthetic query history row',
  0.001
);

INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, payload_json)
VALUES ('10000000-0000-4000-8000-000000000011', 'phase4.synthetic_seed', 'event', '10000000-0000-4000-8000-000000000100', '{"source":"phase4"}');

COMMIT;
`;

const explain = `-- Phase 4 critical read-path EXPLAIN ANALYZE queries.
-- Apply packages/db/fixtures/phase4_synthetic.sql first.

EXPLAIN (ANALYZE, BUFFERS)
-- Public event lookup.
SELECT id, slug, name, status
FROM events
WHERE slug = 'phase4-open' AND status IN ('published', 'running', 'completed');

EXPLAIN (ANALYZE, BUFFERS)
-- Public event roster/person listing.
SELECT p.id, p.given_name, p.family_name, c.name AS club_name
FROM persons p
LEFT JOIN clubs c ON c.id = p.club_id
WHERE p.event_id = '10000000-0000-4000-8000-000000000100'
ORDER BY p.family_name, p.given_name
LIMIT 100;

EXPLAIN (ANALYZE, BUFFERS)
-- My Schedule match lookup.
SELECT m.id, m.status, m.scheduled_at, red.person_id AS red_person_id, blue.person_id AS blue_person_id
FROM matches m
JOIN registrations red ON red.id = m.red_registration_id
JOIN registrations blue ON blue.id = m.blue_registration_id
WHERE red.person_id = '10000000-0000-4000-8000-000000003001'
   OR blue.person_id = '10000000-0000-4000-8000-000000003001'
ORDER BY m.scheduled_at;

EXPLAIN (ANALYZE, BUFFERS)
-- Live lice queue.
SELECT m.id, m.status, m.match_number_label, l.name AS lice_name
FROM matches m
LEFT JOIN lices l ON l.id = m.lice_id
WHERE m.lice_id = '10000000-0000-4000-8000-000000000201'
  AND m.status IN ('scheduled', 'running')
ORDER BY m.scheduled_at
LIMIT 20;

EXPLAIN (ANALYZE, BUFFERS)
-- Pool standings members.
SELECT pm.pool_id, r.id AS registration_id, p.family_name, r.seed
FROM pool_members pm
JOIN registrations r ON r.id = pm.registration_id
JOIN persons p ON p.id = r.person_id
WHERE pm.pool_id = '10000000-0000-4000-8000-000000000501'
ORDER BY r.seed;

EXPLAIN (ANALYZE, BUFFERS)
-- Bracket state.
SELECT bs.round, bs.position, bs.registration_a_id, bs.registration_b_id, m.status
FROM bracket_slots bs
LEFT JOIN matches m ON m.bracket_slot_id = bs.id
WHERE bs.phase_id = '10000000-0000-4000-8000-000000000401'
ORDER BY bs.round, bs.position;

EXPLAIN (ANALYZE, BUFFERS)
-- Audit log lookup.
SELECT id, action, entity_type, entity_id, created_at
FROM audit_log
WHERE entity_type = 'event' AND entity_id = '10000000-0000-4000-8000-000000000100'
ORDER BY created_at DESC
LIMIT 50;

EXPLAIN (ANALYZE, BUFFERS)
-- Tournament query match view.
SELECT *
FROM vw_tournament_query_matches
WHERE tournament_id = '10000000-0000-4000-8000-000000000300'
ORDER BY scheduled_at
LIMIT 50;
`;

if (process.argv.includes('--check')) {
  const existingFixture = readFileSync(fixturePath, 'utf8');
  const existingExplain = readFileSync(explainPath, 'utf8');
  if (existingFixture !== fixture || existingExplain !== explain) {
    console.error(
      'Phase 4 DB fixture SQL is stale. Run: node scripts/db-synthetic-fixture.mjs --write',
    );
    process.exit(1);
  }
  console.log('Phase 4 synthetic fixture and EXPLAIN SQL are up to date.');
  process.exit(0);
}

if (process.argv.includes('--write')) {
  mkdirSync(join(root, 'packages', 'db', 'fixtures'), { recursive: true });
  writeFileSync(fixturePath, fixture);
  writeFileSync(explainPath, explain);
  console.log(`Wrote ${fixturePath}`);
  console.log(`Wrote ${explainPath}`);
  process.exit(0);
}

console.log(fixture);
