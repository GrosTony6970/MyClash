-- 0041_referee_skills_and_availability.sql
-- Adds a skill catalog and per-event referee availability flags.

-- Catalog of referee skills (system defaults + per-event custom skills).
CREATE TABLE IF NOT EXISTS referee_skills (
  id          text PRIMARY KEY,
  event_id    uuid REFERENCES events(id) ON DELETE CASCADE,
  name        text NOT NULL,
  color       text NOT NULL DEFAULT 'slate',
  is_system   boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  updated_at  timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT referee_skills_event_or_system CHECK (
    (is_system = true AND event_id IS NULL)
    OR (is_system = false AND event_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_referee_skills_event ON referee_skills(event_id) WHERE event_id IS NOT NULL;

-- Seed system skills with the existing text role values so existing
-- referee_qualifications.role values keep resolving.
INSERT INTO referee_skills (id, name, color, is_system, sort_order) VALUES
  ('arbitre_declarant', 'Déclarant',  'orange', true, 1),
  ('arbitre_assesseur', 'Assesseur',  'blue',   true, 2),
  ('arbitre_table',     'Table',      'purple', true, 3);

-- Per-event per-referee availability flags. One row per (event, user).
CREATE TABLE IF NOT EXISTS event_referees (
  event_id                      uuid    NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id                       uuid    NOT NULL,
  available_all_tournaments     boolean NOT NULL DEFAULT true,
  available_all_event_duration  boolean NOT NULL DEFAULT true,
  created_at                    timestamptz NOT NULL DEFAULT NOW(),
  updated_at                    timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id)
);

-- Backfill: every existing referee_qualification gets an event_referees row
-- (idempotent — ON CONFLICT DO NOTHING).
INSERT INTO event_referees (event_id, user_id)
  SELECT DISTINCT event_id, user_id FROM referee_qualifications WHERE active = true
ON CONFLICT (event_id, user_id) DO NOTHING;

-- Standalone index to support "events where user X is a referee" queries
-- (the composite PK covers (event_id, user_id) but not the reverse direction).
CREATE INDEX IF NOT EXISTS idx_event_referees_user ON event_referees(user_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE referee_skills  ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_referees  ENABLE ROW LEVEL SECURITY;

-- referee_skills: system skills are world-readable; event-scoped skills are
-- readable by members of the owning org. Writes: system rows require super_admin;
-- event-scoped rows require admin role on the owning org.
CREATE POLICY "referee_skills_select" ON referee_skills FOR SELECT
  USING (
    is_system
    OR is_super_admin()
    OR (event_id IS NOT NULL AND is_org_member(event_org_id(event_id)))
  );

CREATE POLICY "referee_skills_write" ON referee_skills FOR ALL
  USING (
    is_super_admin()
    OR (event_id IS NOT NULL AND has_org_role(event_org_id(event_id), 'admin'))
  );

-- event_referees: same shape as referee_qualifications — self-read + org member
-- read; admin write.
CREATE POLICY "event_referees_select" ON event_referees FOR SELECT
  USING (
    is_super_admin()
    OR user_id = auth.uid()
    OR is_org_member(event_org_id(event_id))
  );

CREATE POLICY "event_referees_write" ON event_referees FOR ALL
  USING (is_super_admin() OR has_org_role(event_org_id(event_id), 'admin'));
