-- ============================================================
-- MyClash — Global identity model expansion
-- Migration: 0023_global_persons.sql
-- Dep: 0001_init.sql, 0017_fighter_profile_links.sql
--
-- Renames fighters → global_persons and adds role flags so
-- referees and workshop participants can have a global identity
-- alongside fighters. All changes are non-destructive.
-- ============================================================

-- ── 1. Rename table (Postgres cascades FK references automatically) ───────────
ALTER TABLE fighters RENAME TO global_persons;

-- ── 2. Rename merge column ────────────────────────────────────────────────────
ALTER TABLE global_persons
  RENAME COLUMN merged_into_fighter_id TO merged_into_id;

-- ── 3. Role flags — backfill all existing rows as fighters ───────────────────
ALTER TABLE global_persons
  ADD COLUMN is_fighter              BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN is_referee              BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN is_workshop_participant BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE global_persons SET is_fighter = TRUE;

-- ── 4. referee_profiles extension table (1:1 optional) ───────────────────────
CREATE TABLE referee_profiles (
  global_person_id UUID        PRIMARY KEY REFERENCES global_persons(id) ON DELETE CASCADE,
  certifications   JSONB       NOT NULL DEFAULT '[]',
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 5. persons — rename FK column ─────────────────────────────────────────────
ALTER TABLE persons
  RENAME COLUMN global_fighter_id TO global_person_id;

-- ── 6. referee_qualifications — optional global link ─────────────────────────
ALTER TABLE referee_qualifications
  ADD COLUMN global_person_id UUID REFERENCES global_persons(id) ON DELETE SET NULL;

CREATE INDEX idx_referee_qualifications_global_person_id
  ON referee_qualifications(global_person_id)
  WHERE global_person_id IS NOT NULL;

-- ── 7. workshop_enrollments — optional global link ───────────────────────────
ALTER TABLE workshop_enrollments
  ADD COLUMN global_person_id UUID REFERENCES global_persons(id) ON DELETE SET NULL;

CREATE INDEX idx_workshop_enrollments_global_person_id
  ON workshop_enrollments(global_person_id)
  WHERE global_person_id IS NOT NULL;

-- ── 8. FK column renames on profile link tables ───────────────────────────────
ALTER TABLE workshop_instructors RENAME COLUMN fighter_id TO global_person_id;
ALTER TABLE fighter_clubs        RENAME COLUMN fighter_id TO global_person_id;
ALTER TABLE fighter_weapons      RENAME COLUMN fighter_id TO global_person_id;
