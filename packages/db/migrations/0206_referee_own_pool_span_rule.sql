-- 0206: the switch for "refereeing while a Pool one fights in is running" (W1.1, ADR-016).
--
-- Operator ruling 5: a fighter is busy for their whole Pool's span, everywhere, refereeing
-- included — as a Discouraged rule (amber, the organiser may confirm), not an Impossible one.
-- Ruling 21: it gets its OWN per-Event switch, default ON, next to "own Pool at another time",
-- so a club that lets poolmates referee each other can keep one rule and drop the other.
-- Their own bouts overlapping stays Impossible and has no switch.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table, no policy change: one column on pool_assignment_settings, which keeps its
-- policies. The API's service role is its only reader and writer.

ALTER TABLE pool_assignment_settings
  ADD COLUMN IF NOT EXISTS enable_own_pool_span_rule BOOLEAN NOT NULL DEFAULT TRUE;
