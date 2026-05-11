-- T-1214: Natural-language tournament query

CREATE TABLE IF NOT EXISTS tournament_query_settings (
  tournament_id UUID PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE,
  access_policy TEXT NOT NULL DEFAULT 'organizers_only'
    CHECK (access_policy IN (
      'organizers_only',
      'organizers_head_judges',
      'organizers_head_judges_coaches',
      'anyone_with_tournament_access'
    )),
  rate_limit_per_hour INTEGER NOT NULL DEFAULT 60 CHECK (rate_limit_per_hour BETWEEN 1 AND 500),
  updated_by_user_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tournament_query_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  question TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'fr')),
  tool_name TEXT,
  summary TEXT,
  cost_eur NUMERIC(10,6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tournament_query_history_user_idx
  ON tournament_query_history(tournament_id, user_id, created_at DESC);

ALTER TABLE tournament_query_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_query_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tournament_query_settings_org_admin_read" ON tournament_query_settings
  FOR SELECT USING (
    tournament_id IN (
      SELECT t.id
      FROM tournaments t
      JOIN events e ON e.id = t.event_id
      JOIN organization_members om ON om.organization_id = e.organization_id
      WHERE om.user_id = (SELECT auth.uid()) AND om.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "tournament_query_settings_org_admin_write" ON tournament_query_settings
  FOR ALL USING (
    tournament_id IN (
      SELECT t.id
      FROM tournaments t
      JOIN events e ON e.id = t.event_id
      JOIN organization_members om ON om.organization_id = e.organization_id
      WHERE om.user_id = (SELECT auth.uid()) AND om.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "tournament_query_history_own_read" ON tournament_query_history
  FOR SELECT USING (user_id = (SELECT auth.uid()));

CREATE POLICY "tournament_query_history_org_admin_read" ON tournament_query_history
  FOR SELECT USING (
    event_id IN (
      SELECT e.id
      FROM events e
      JOIN organization_members om ON om.organization_id = e.organization_id
      WHERE om.user_id = (SELECT auth.uid()) AND om.role IN ('owner', 'admin')
    )
  );

CREATE OR REPLACE VIEW vw_tournament_query_fighters AS
SELECT
  r.tournament_id,
  t.event_id,
  r.id AS registration_id,
  p.id AS person_id,
  r.fighter_id,
  trim(p.given_name || ' ' || p.family_name) AS display_name,
  p.given_name,
  p.family_name,
  c.name AS club_name,
  p.hema_ratings_id,
  COALESCE(f.country_code, c.country_code) AS country_code,
  t.weapon,
  t.category,
  r.status,
  r.seed,
  r.bib_number,
  p.claimed_by_user_id
FROM registrations r
JOIN tournaments t ON t.id = r.tournament_id
JOIN persons p ON p.id = r.person_id
LEFT JOIN fighters f ON f.id = r.fighter_id
LEFT JOIN clubs c ON c.id = p.club_id;

CREATE OR REPLACE VIEW vw_tournament_query_pools AS
SELECT
  t.id AS tournament_id,
  t.event_id,
  ph.id AS phase_id,
  p.id AS pool_id,
  p.name AS pool_name,
  p.sort_order
FROM pools p
JOIN phases ph ON ph.id = p.phase_id
JOIN tournaments t ON t.id = ph.tournament_id;

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
  m.match_number_label
FROM matches m
JOIN phases ph ON ph.id = m.phase_id
JOIN tournaments t ON t.id = ph.tournament_id
LEFT JOIN pools po ON po.id = m.pool_id
LEFT JOIN bracket_slots bs ON bs.id = m.bracket_slot_id
LEFT JOIN lices l ON l.id = m.lice_id
LEFT JOIN registrations rr ON rr.id = m.red_registration_id
LEFT JOIN persons rp ON rp.id = rr.person_id
LEFT JOIN clubs rc ON rc.id = rp.club_id
LEFT JOIN registrations br ON br.id = m.blue_registration_id
LEFT JOIN persons bp ON bp.id = br.person_id
LEFT JOIN clubs bc ON bc.id = bp.club_id;

CREATE OR REPLACE VIEW vw_tournament_query_exchange_summary AS
SELECT
  t.id AS tournament_id,
  m.id AS match_id,
  count(*) FILTER (WHERE e.type = 'double' AND e.voided = false) AS doubles,
  count(*) FILTER (WHERE e.type = 'afterblow' AND e.voided = false) AS afterblows
FROM matches m
JOIN phases ph ON ph.id = m.phase_id
JOIN tournaments t ON t.id = ph.tournament_id
LEFT JOIN exchanges e ON e.match_id = m.id
GROUP BY t.id, m.id;

CREATE OR REPLACE VIEW vw_tournament_query_referees AS
SELECT
  COALESCE(t_pool.id, t_match.id) AS tournament_id,
  ra.event_id,
  ra.user_id,
  trim(p.given_name || ' ' || p.family_name) AS judge_name,
  ra.pool_id,
  pool.name AS pool_name,
  ra.match_id,
  ra.role,
  ra.status
FROM referee_assignments ra
LEFT JOIN persons p ON p.event_id = ra.event_id AND p.claimed_by_user_id = ra.user_id
LEFT JOIN pools pool ON pool.id = ra.pool_id
LEFT JOIN phases ph_pool ON ph_pool.id = pool.phase_id
LEFT JOIN tournaments t_pool ON t_pool.id = ph_pool.tournament_id
LEFT JOIN matches match ON match.id = ra.match_id
LEFT JOIN phases ph_match ON ph_match.id = match.phase_id
LEFT JOIN tournaments t_match ON t_match.id = ph_match.tournament_id;
