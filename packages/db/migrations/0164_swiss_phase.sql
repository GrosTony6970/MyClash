-- Migration 0164: the Swiss-system phase.
--
-- `phases.type` has accepted 'swiss' since 0001_init.sql, but nothing could
-- ever create one: there was no round table, no roster table, and no way for a
-- match to say which round it belonged to.
--
-- Two structural decisions worth stating up front, because they are why this
-- migration is small:
--
--   * A Swiss phase creates NO `pools` rows. Swiss is not pool-shaped — there
--     is no fixed group a fighter belongs to for the whole phase, the field is
--     re-paired every round. Reusing `pools` would have leaked pool semantics
--     (pool standings, pool affinity in the scheduler, pool_id-keyed referee
--     clearing) into a phase that does not have them.
--
--   * A Swiss match's round goes in a NEW column, not `matches.round_number`.
--     0111 already uses round_number for the best-of-N round INSIDE a single
--     bout, and scoring.service filters exchanges by it; reusing it would break
--     BO3/BO5/BO7 scoring everywhere.
--
-- The 4th programme token lands in the same migration as the tables. A Swiss
-- phase that the programme, staffing, venue and compensation CHECKs still
-- reject is a broken half-state: the phase would exist and then fail to
-- schedule, staff or pay. Both halves ship together or neither does.

BEGIN;

-- ── swiss_rounds ─────────────────────────────────────────────────────────────
-- One row per generated round. `pairing_meta_json` carries the ranked snapshot
-- the pairing was computed from, the engine's warnings (forced rematches,
-- singleton bands) and any manual adjustments, so both the admin round card and
-- the public round view can badge a round that was not purely machine-paired.
CREATE TABLE IF NOT EXISTS swiss_rounds (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id            UUID NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
  round_number        INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','running','completed')),
  -- The fighter who sat this round out. SET NULL rather than CASCADE: deleting
  -- a registration must not silently delete the round everyone else played.
  bye_registration_id UUID REFERENCES registrations(id) ON DELETE SET NULL,
  pairing_meta_json   JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (phase_id, round_number)
);

CREATE INDEX IF NOT EXISTS idx_swiss_rounds_phase ON swiss_rounds (phase_id);

-- ── swiss_entrants ───────────────────────────────────────────────────────────
-- The phase roster, frozen at generation. An explicit table rather than
-- deriving the field from `registrations` because a Swiss phase can be one
-- stage of a three-stage tournament (pools → Swiss → bracket) and its field is
-- then a CUT of the registrations, not all of them.
--
-- `joined_round` is deliberately absent: the field is frozen at generation, so
-- the column would be constant 1. It is the column to add if late entry is ever
-- allowed.
CREATE TABLE IF NOT EXISTS swiss_entrants (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id           UUID NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
  registration_id    UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  -- Set when a fighter withdraws mid-phase: excluded from every later pairing,
  -- but the rounds they already played still stand and still count toward
  -- their opponents' tiebreaks.
  withdrawn_at_round INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (phase_id, registration_id)
);

CREATE INDEX IF NOT EXISTS idx_swiss_entrants_phase ON swiss_entrants (phase_id);
CREATE INDEX IF NOT EXISTS idx_swiss_entrants_registration
  ON swiss_entrants (registration_id);

-- ── matches.swiss_round_id ───────────────────────────────────────────────────
-- SET NULL, matching bracket_slot_id: deleting a round must not delete the
-- matches, so the service deletes matches FIRST and the orphan case cannot be
-- reached through the API.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS swiss_round_id UUID
  REFERENCES swiss_rounds(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_matches_swiss_round ON matches (swiss_round_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- PostgREST exposes every table to `anon`, so RLS is the only access boundary.
-- Both policies are bracket_slots' (0002_rls.sql), which is the right shape:
-- reachable through phases → tournaments → events, readable by org members and
-- by anyone once the event is public, writable by org admins.
ALTER TABLE swiss_rounds   ENABLE ROW LEVEL SECURITY;
ALTER TABLE swiss_entrants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "swiss_rounds_select" ON swiss_rounds FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM phases ph
      JOIN tournaments t ON t.id = ph.tournament_id
      JOIN events e ON e.id = t.event_id
      WHERE ph.id = swiss_rounds.phase_id
        AND (is_org_member(e.organization_id) OR e.status IN ('published','running','completed'))
    )
  );

CREATE POLICY "swiss_rounds_write" ON swiss_rounds FOR ALL
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM phases ph
      JOIN tournaments t ON t.id = ph.tournament_id
      JOIN events e ON e.id = t.event_id
      WHERE ph.id = swiss_rounds.phase_id
        AND has_org_role(e.organization_id, 'admin')
    )
  );

CREATE POLICY "swiss_entrants_select" ON swiss_entrants FOR SELECT
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM phases ph
      JOIN tournaments t ON t.id = ph.tournament_id
      JOIN events e ON e.id = t.event_id
      WHERE ph.id = swiss_entrants.phase_id
        AND (is_org_member(e.organization_id) OR e.status IN ('published','running','completed'))
    )
  );

CREATE POLICY "swiss_entrants_write" ON swiss_entrants FOR ALL
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM phases ph
      JOIN tournaments t ON t.id = ph.tournament_id
      JOIN events e ON e.id = t.event_id
      WHERE ph.id = swiss_entrants.phase_id
        AND has_org_role(e.organization_id, 'admin')
    )
  );

-- ── The 4th programme token ──────────────────────────────────────────────────
-- Five closed CHECKs spell out the coarse pool/bracket/finals taxonomy, and
-- every one of them rejects 'swiss' today. Each is dropped and re-added, which
-- revalidates the existing rows — none of which can hold 'swiss' yet, so the
-- revalidation is free.
--
-- This is also what removes the silent mis-bucketing class of defect: without
-- the token, code infers "bracket" from `type !== 'pool'` and a Swiss phase
-- gets scheduled, staffed, housed and paid as if it were a knockout.

ALTER TABLE event_programme_blocks
  DROP CONSTRAINT IF EXISTS event_programme_blocks_competition_phase_check,
  ADD  CONSTRAINT event_programme_blocks_competition_phase_check
    CHECK (competition_phase IN ('pool', 'swiss', 'bracket', 'finals'));

ALTER TABLE tournament_slot_config
  DROP CONSTRAINT IF EXISTS tournament_slot_config_phase_type_check,
  ADD  CONSTRAINT tournament_slot_config_phase_type_check
    CHECK (phase_type IN ('pool','swiss','bracket','finals'));

ALTER TABLE event_slot_config_default
  DROP CONSTRAINT IF EXISTS event_slot_config_default_phase_type_check,
  ADD  CONSTRAINT event_slot_config_default_phase_type_check
    CHECK (phase_type IN ('pool','swiss','bracket','finals'));

ALTER TABLE tournament_phase_venues
  DROP CONSTRAINT IF EXISTS tournament_phase_venues_phase_kind_check,
  ADD  CONSTRAINT tournament_phase_venues_phase_kind_check
    CHECK (phase_kind IN ('pool', 'swiss', 'bracket'));

ALTER TABLE referee_compensation_role_rates
  DROP CONSTRAINT IF EXISTS referee_compensation_role_rates_compensation_phase_check,
  ADD  CONSTRAINT referee_compensation_role_rates_compensation_phase_check
    CHECK (compensation_phase IN ('pool','swiss','bracket','finals'));

-- Swiss pays between pool and bracket on every role: a Swiss bout is a full
-- competitive bout (unlike a pool bout) but carries no knockout consequence
-- (unlike a bracket bout). Applied to every existing plan, since a plan with no
-- Swiss rate would pay 0 for the phase rather than falling back to anything.
INSERT INTO referee_compensation_role_rates (plan_id, referee_role, compensation_phase, tokens_per_match)
SELECT p.id, r.referee_role, 'swiss', r.tokens
FROM referee_compensation_plans p
CROSS JOIN (VALUES
  ('arbitre_declarant', 3),
  ('arbitre_assesseur', 2),
  ('arbitre_table',     1)
) AS r(referee_role, tokens)
ON CONFLICT (plan_id, referee_role, compensation_phase) DO NOTHING;

-- ── Query view ───────────────────────────────────────────────────────────────
-- `swiss_round` is appended at the END of the column list on purpose: CREATE OR
-- REPLACE VIEW can only add columns there, and replacing the view outright
-- would need every dependent object dropped with it.
CREATE OR REPLACE VIEW vw_tournament_query_matches AS
SELECT
  t.id AS tournament_id,
  t.event_id,
  m.id AS match_id,
  ph.id AS phase_id,
  ph.type AS phase_type,
  po.id AS pool_id,
  po.name AS pool_name,
  bs.round AS bracket_round,
  bs.position AS bracket_position,
  l.id AS lice_id,
  l.name AS lice_name,
  l.sort_order + 1 AS lice_number,
  m.red_registration_id,
  m.blue_registration_id,
  trim(rp.given_name || ' ' || rp.family_name) AS red_name,
  trim(bp.given_name || ' ' || bp.family_name) AS blue_name,
  rc.name AS red_club,
  bc.name AS blue_club,
  m.scheduled_at,
  m.started_at,
  m.ended_at,
  m.duration_active_ms,
  m.duration_total_ms,
  m.red_score,
  m.blue_score,
  m.winner_registration_id,
  m.status,
  m.match_number_label,
  sr.round_number AS swiss_round
FROM matches m
JOIN phases ph ON ph.id = m.phase_id
JOIN tournaments t ON t.id = ph.tournament_id
LEFT JOIN pools po ON po.id = m.pool_id
LEFT JOIN bracket_slots bs ON bs.id = m.bracket_slot_id
LEFT JOIN swiss_rounds sr ON sr.id = m.swiss_round_id
LEFT JOIN lices l ON l.id = m.lice_id
LEFT JOIN registrations rr ON rr.id = m.red_registration_id
LEFT JOIN persons rp ON rp.id = rr.person_id
LEFT JOIN clubs rc ON rc.id = rp.club_id
LEFT JOIN registrations br ON br.id = m.blue_registration_id
LEFT JOIN persons bp ON bp.id = br.person_id
LEFT JOIN clubs bc ON bc.id = bp.club_id;

COMMIT;
