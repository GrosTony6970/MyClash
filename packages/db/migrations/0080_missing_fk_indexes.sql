-- 0080_missing_fk_indexes.sql
--
-- Pre-redeploy index sweep. The audit at C:/Users/Tony/.claude/plans/
-- schedule-in-the-schedule-immutable-cake.md found 8 FK columns that
-- views and hot-path queries join through but lack a supporting
-- index. Adding them now (fresh DB, no rows) costs nothing; later
-- the views in 0081 / 0083 and the existing 0010 / 0079 views all
-- benefit.
--
-- phases.tournament_id is intentionally NOT added here: the existing
-- composite phases_tournament_type_visibility_idx (0022:21) already
-- covers (tournament_id, …) — leading-column reuse makes a standalone
-- index redundant.

BEGIN;

-- matches: phase_id is joined by both vw_tournament_query_matches
-- (0079:77) and vw_event_stats (0010). bracket_slot_id is sparse so
-- partial.
CREATE INDEX IF NOT EXISTS matches_phase_id_idx
  ON matches (phase_id);

CREATE INDEX IF NOT EXISTS matches_bracket_slot_id_idx
  ON matches (bracket_slot_id)
  WHERE bracket_slot_id IS NOT NULL;

-- pools / bracket_slots: vw_tournament_query_matches LEFT JOINs both.
CREATE INDEX IF NOT EXISTS pools_phase_id_idx
  ON pools (phase_id);

CREATE INDEX IF NOT EXISTS bracket_slots_phase_id_idx
  ON bracket_slots (phase_id);

-- registrations: most reads filter by (tournament_id, status).
-- Composite covers "active fighters in this tournament" without
-- adding a separate single-column index.
CREATE INDEX IF NOT EXISTS registrations_tournament_status_idx
  ON registrations (tournament_id, status);

-- persons: every fighter-facing view joins through these columns.
-- club_id index is partial because independent / walk-in fighters
-- legitimately have club_id IS NULL. global_person_id likewise:
-- purely-local persons have no HEMA link.
CREATE INDEX IF NOT EXISTS persons_club_id_idx
  ON persons (club_id)
  WHERE club_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS persons_global_person_id_idx
  ON persons (global_person_id)
  WHERE global_person_id IS NOT NULL;

-- referee_assignments: staff listings load by event_id on every
-- event-detail page.
CREATE INDEX IF NOT EXISTS referee_assignments_event_id_idx
  ON referee_assignments (event_id);

COMMIT;
