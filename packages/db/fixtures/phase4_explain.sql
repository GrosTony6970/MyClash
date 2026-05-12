-- Phase 4 critical read-path EXPLAIN ANALYZE queries.
-- Apply packages/db/fixtures/phase4_synthetic.sql first.

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, slug, name, status
FROM events
WHERE slug = 'phase4-open' AND status IN ('published', 'running', 'completed');

EXPLAIN (ANALYZE, BUFFERS)
SELECT p.id, p.given_name, p.family_name, c.name AS club_name
FROM persons p
LEFT JOIN clubs c ON c.id = p.club_id
WHERE p.event_id = '10000000-0000-4000-8000-000000000100'
ORDER BY p.family_name, p.given_name
LIMIT 100;

EXPLAIN (ANALYZE, BUFFERS)
SELECT m.id, m.status, m.scheduled_at, red.person_id AS red_person_id, blue.person_id AS blue_person_id
FROM matches m
JOIN registrations red ON red.id = m.red_registration_id
JOIN registrations blue ON blue.id = m.blue_registration_id
WHERE red.person_id = '10000000-0000-4000-8000-000000003001'
   OR blue.person_id = '10000000-0000-4000-8000-000000003001'
ORDER BY m.scheduled_at;

EXPLAIN (ANALYZE, BUFFERS)
SELECT m.id, m.status, m.match_number_label, l.name AS lice_name
FROM matches m
LEFT JOIN lices l ON l.id = m.lice_id
WHERE m.lice_id = '10000000-0000-4000-8000-000000000201'
  AND m.status IN ('scheduled', 'running')
ORDER BY m.scheduled_at
LIMIT 20;

EXPLAIN (ANALYZE, BUFFERS)
SELECT pm.pool_id, r.id AS registration_id, p.family_name, r.seed
FROM pool_members pm
JOIN registrations r ON r.id = pm.registration_id
JOIN persons p ON p.id = r.person_id
WHERE pm.pool_id = '10000000-0000-4000-8000-000000000501'
ORDER BY r.seed;

EXPLAIN (ANALYZE, BUFFERS)
SELECT bs.round, bs.position, bs.registration_a_id, bs.registration_b_id, m.status
FROM bracket_slots bs
LEFT JOIN matches m ON m.bracket_slot_id = bs.id
WHERE bs.phase_id = '10000000-0000-4000-8000-000000000401'
ORDER BY bs.round, bs.position;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, action, entity_type, entity_id, created_at
FROM audit_log
WHERE entity_type = 'event' AND entity_id = '10000000-0000-4000-8000-000000000100'
ORDER BY created_at DESC
LIMIT 50;

EXPLAIN (ANALYZE, BUFFERS)
SELECT *
FROM vw_tournament_query_matches
WHERE tournament_id = '10000000-0000-4000-8000-000000000300'
ORDER BY scheduled_at
LIMIT 50;
