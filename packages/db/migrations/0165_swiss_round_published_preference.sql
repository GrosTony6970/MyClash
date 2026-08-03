-- ============================================================
-- MyClash — "Swiss round published" notification preference
-- Migration: 0165_swiss_round_published_preference.sql
-- Dep: 0021_event_broadcast_notifications.sql (notification_preferences),
--      0164_swiss_phase.sql (swiss_rounds)
--
-- One column. A Swiss round auto-pairs the moment the previous one completes
-- (decision 3), so the notification fires without an organiser pressing
-- anything — which is exactly when a fighter needs to know their next opponent
-- and piste, and also exactly why it needs its own opt-out rather than riding
-- on `schedule_changes`.
-- ============================================================

-- Defaults ON: entering a Swiss tournament is the consent. A fighter who wants
-- silence turns it off in /me/settings, the same as every other toggle here.
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS swiss_round_published BOOLEAN NOT NULL DEFAULT TRUE;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- End of 0165_swiss_round_published_preference.sql
-- ============================================================
