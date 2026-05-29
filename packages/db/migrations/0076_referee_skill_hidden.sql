-- Per-event hidden skills.
--
-- System skills (arbitre_declarant, arbitre_assesseur, arbitre_table) live
-- as global rows in referee_skills (event_id = NULL). A row-level is_hidden
-- flag would hide them in every event, which is not what we want — the
-- "hide" decision is scoped per-event so each organizer can declutter the
-- workspace without affecting anyone else.
--
-- A presence row means "hide this skill in this event". Absence means
-- visible. Existing qualifications on hidden skills stay in the DB but are
-- filtered out of the active-skills projection.

CREATE TABLE event_hidden_skills (
  event_id   uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  skill_id   text NOT NULL REFERENCES referee_skills(id) ON DELETE CASCADE,
  hidden_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, skill_id)
);

CREATE INDEX event_hidden_skills_event_idx ON event_hidden_skills (event_id);
