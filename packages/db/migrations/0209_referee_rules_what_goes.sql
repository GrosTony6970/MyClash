-- 0209: what the one referee checker replaced goes (W1.4, ADR-016, ADR-019).
--
-- 1. Three switches for rules that have no switch. Refereeing while fighting, refereeing twice at
--    once and refereeing outside one's availability are Impossible (hard rule 8): nothing has read
--    `enable_officiate_vs_fight_rule`, `enable_double_booked_rule` or `enable_availability_rule`
--    since W1.3. `enforce_fighter_referee_no_overlap` was a CHECK-pinned TRUE that gated nothing;
--    dropping the column takes its named CHECK with it.
-- 2. `matches.referee_id` (0039): an event-scoped persons.id written by nobody since the referee
--    board (every duty is a `referee_assignments` row, keyed by global_persons.id). Its last
--    readers moved onto the duties in the same commit. Its ON DELETE SET NULL goes with it.
-- 3. Writing referee rows straight through PostgREST. `referee_assignments_write` (0002) let any
--    organisation admin insert, update or delete any row of their Event past every check the API
--    makes (the checker, the lock). The API's service role is the only writer. The policy goes and
--    the two public roles lose INSERT, UPDATE and DELETE, so a stray write fails loudly (42501)
--    instead of touching no row in silence (ruling 144). SELECT is untouched (0204, 0205).
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table. referee_assignments keeps RLS on and its SELECT policy; with no write policy and no
-- write grant, anon and authenticated cannot write it at all. `pnpm db:rls-probe` checks it as the
-- seeded organisation admin, and packages/db/test/referee-rules-what-goes.test.ts pins the statements.
--
-- ── Archives ────────────────────────────────────────────────────────────────
--
-- An archive exported before this migration carries the dropped columns and does not restore
-- (ruling 143: none exists in production, the stack is wiped and redeployed).
--
-- No IF EXISTS anywhere: a mistyped name must fail the replay, not pass it.

ALTER TABLE pool_assignment_settings
  DROP COLUMN enable_officiate_vs_fight_rule,
  DROP COLUMN enable_double_booked_rule,
  DROP COLUMN enable_availability_rule,
  DROP COLUMN enforce_fighter_referee_no_overlap;

ALTER TABLE matches
  DROP COLUMN referee_id;

DROP POLICY "referee_assignments_write" ON referee_assignments;

REVOKE INSERT, UPDATE, DELETE ON referee_assignments FROM anon, authenticated;
