-- Migration 0060: per-tournament + event-level referee staffing slot config.
--
-- Replaces the hard-coded 3 roles (arbitre_declarant / arbitre_assesseur /
-- arbitre_table) baked into the assignment + pool screens with a config-
-- driven slot list. Each (tournament, phase_type) row carries 1..6 slots,
-- each slot allows one or more `referee_skills.id` values.
--
-- Resolver order (StaffingService.getResolvedConfig):
--   1. tournament_slot_config rows for (tournament, phase_type)
--   2. event_slot_config_default rows for (event, phase_type)
--   3. Hard-coded floor — 3 slots, one of arbitre_declarant /
--      arbitre_assesseur / arbitre_table each. Preserves legacy behaviour
--      for events that never touch the new Staffing tab.
--
-- Backwards compatibility: referee_assignments.role already stores a
-- referee_skills.id string. Existing rows continue to resolve against
-- whichever config applies — no data migration required.

CREATE TABLE IF NOT EXISTS tournament_slot_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  phase_type      TEXT NOT NULL CHECK (phase_type IN ('pool','bracket','finals')),
  slot_index      INT  NOT NULL CHECK (slot_index BETWEEN 1 AND 6),
  display_name    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, phase_type, slot_index)
);

CREATE INDEX IF NOT EXISTS tournament_slot_config_tournament_phase_idx
  ON tournament_slot_config (tournament_id, phase_type);

CREATE TABLE IF NOT EXISTS tournament_slot_allowed_skills (
  slot_config_id  UUID NOT NULL REFERENCES tournament_slot_config(id) ON DELETE CASCADE,
  skill_id        TEXT NOT NULL REFERENCES referee_skills(id) ON DELETE RESTRICT,
  PRIMARY KEY (slot_config_id, skill_id)
);

CREATE INDEX IF NOT EXISTS tournament_slot_allowed_skills_skill_idx
  ON tournament_slot_allowed_skills (skill_id);

-- Event-level default mirrors the per-tournament shape. Tournaments with
-- no tournament_slot_config rows for a given phase_type fall back here.
CREATE TABLE IF NOT EXISTS event_slot_config_default (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  phase_type      TEXT NOT NULL CHECK (phase_type IN ('pool','bracket','finals')),
  slot_index      INT  NOT NULL CHECK (slot_index BETWEEN 1 AND 6),
  display_name    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, phase_type, slot_index)
);

CREATE INDEX IF NOT EXISTS event_slot_config_default_event_phase_idx
  ON event_slot_config_default (event_id, phase_type);

CREATE TABLE IF NOT EXISTS event_slot_config_default_skills (
  slot_config_id  UUID NOT NULL REFERENCES event_slot_config_default(id) ON DELETE CASCADE,
  skill_id        TEXT NOT NULL REFERENCES referee_skills(id) ON DELETE RESTRICT,
  PRIMARY KEY (slot_config_id, skill_id)
);

CREATE INDEX IF NOT EXISTS event_slot_config_default_skills_skill_idx
  ON event_slot_config_default_skills (skill_id);

-- Force PostgREST to refresh its schema cache so the new tables become
-- queryable without a service restart.
NOTIFY pgrst, 'reload schema';
