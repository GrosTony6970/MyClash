-- 0073_matches_bracket_slot_id_fkey.sql
--
-- The initial schema (0001_init.sql:392) declared bracket_slot_id UUID
-- without REFERENCES. Migration 0057 added the matches.phase_id FK in
-- the same shape — its comment called out the sibling bracket_slots
-- table but didn't fix matches.bracket_slot_id itself. PostgREST can't
-- resolve the embedded bracket_slots(...) select on /matches/:id/display
-- (staff.service.ts:364) or in the exports endpoint
-- (exports.service.ts:180), so the admin scoreboard 400s on every
-- match.
--
-- bracket_slot_id is nullable (pool matches design); NULL out orphans
-- rather than deleting rows. ON DELETE SET NULL preserves match
-- history if a bracket slot is ever removed.

BEGIN;

-- 1. NULL out any orphan refs so the FK can land cleanly. Highly
--    unlikely in practice — bracket_slots cascade-delete from phases
--    (0001:355), and matches now cascade-delete from phases too
--    (0057). Cheap insurance against historical data drift.
UPDATE matches
SET bracket_slot_id = NULL
WHERE bracket_slot_id IS NOT NULL
  AND bracket_slot_id NOT IN (SELECT id FROM bracket_slots);

-- 2. Add the FK constraint.
ALTER TABLE matches
  ADD CONSTRAINT matches_bracket_slot_id_fkey
  FOREIGN KEY (bracket_slot_id) REFERENCES bracket_slots(id) ON DELETE SET NULL;

-- 3. Refresh PostgREST's schema cache so the embed resolves without
--    a service restart. Idempotent + no-op when nobody's listening.
NOTIFY pgrst, 'reload schema';

COMMIT;
