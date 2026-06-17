-- 0101_workshop_breaks.sql
--
-- Workshop-only break blocks for the workshop schedule board (lunch,
-- changeover, etc.). Deliberately a SEPARATE store from the event
-- programme blocks (0028) so a workshop break never leaks onto the main
-- event schedule and vice-versa.
--
-- Times are stored as plain HH:MM text scoped to a day index (0-based
-- into the event's day range) — the board axis is per-day, like the
-- event schedule's break bars.

CREATE TABLE IF NOT EXISTS workshop_breaks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  day_index  INTEGER NOT NULL DEFAULT 0,
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL,
  label      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workshop_breaks_event ON workshop_breaks(event_id);

ALTER TABLE workshop_breaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workshop_breaks_select" ON workshop_breaks FOR SELECT
  USING (is_super_admin() OR is_org_member(event_org_id(event_id)));

CREATE POLICY "workshop_breaks_write" ON workshop_breaks FOR ALL
  USING (is_super_admin() OR has_org_role(event_org_id(event_id), 'admin'));

NOTIFY pgrst, 'reload schema';
