-- ============================================================
-- MyClash — "Organiser published an event" notification
-- Migration: 0160_event_first_published_and_organizer_updates.sql
-- Dep: 0001_init.sql (events), 0159_organization_follows.sql,
--      0021_event_broadcast_notifications.sql (notification_preferences)
--
-- Two columns, both in service of announcing a publish exactly once.
-- ============================================================

-- ── events.first_published_at ────────────────────────────────────────────────
-- The once-only guard, enforced at the DATABASE rather than in BullMQ.
--
-- Publishing becomes a compare-and-set: UPDATE ... WHERE first_published_at IS
-- NULL, and only a returned row triggers the announcement. Relying on BullMQ's
-- jobId dedupe would not hold — those jobs carry removeOnComplete age 86400, so
-- the guard evaporates after a day and an unpublish/republish next week would
-- re-spam every follower.
ALTER TABLE events ADD COLUMN IF NOT EXISTS first_published_at TIMESTAMPTZ;

-- THE most important statement in this migration. Every event that is already
-- published (or beyond) is treated as already announced. Without this backfill
-- the first deploy would notify every follower about every historical event.
UPDATE events
   SET first_published_at = COALESCE(updated_at, created_at)
 WHERE first_published_at IS NULL
   AND status IN ('published', 'running', 'completed', 'archived');

-- ── notification_preferences.organizer_updates ──────────────────────────────
-- Per-user opt-out, defaulting ON: following an organiser is already an
-- explicit opt-in, so the follow itself is the consent.
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS organizer_updates BOOLEAN NOT NULL DEFAULT TRUE;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- End of 0160_event_first_published_and_organizer_updates.sql
-- ============================================================
