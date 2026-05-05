-- ============================================================
-- MyClash - Leagues / Tournois Federaux
-- ============================================================

CREATE TABLE IF NOT EXISTS leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  season_year INTEGER NOT NULL,
  description TEXT,
  logo_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  public_visibility BOOLEAN NOT NULL DEFAULT FALSE,
  scoring_system TEXT NOT NULL DEFAULT 'ffamhe_tf_2026',
  scoring_config JSONB NOT NULL DEFAULT '{
    "scoringSystem": "ffamhe_tf_2026",
    "rankingDimensions": "weapon",
    "tieBreakers": ["total_points", "participation_count", "medal_count", "double_hit_average"]
  }'::jsonb,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT leagues_status_check CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT leagues_scoring_system_check CHECK (scoring_system IN ('ffamhe_tf_2026', 'custom'))
);

CREATE TABLE IF NOT EXISTS league_organization_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(league_id, organization_id),
  CONSTRAINT league_org_roles_role_check CHECK (role IN ('member', 'admin', 'owner'))
);

CREATE TABLE IF NOT EXISTS league_user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(league_id, user_id),
  CONSTRAINT league_user_roles_role_check CHECK (role IN ('admin', 'owner'))
);

CREATE TABLE IF NOT EXISTS league_tournament_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'requested',
  requested_by_user_id UUID NOT NULL,
  reviewed_by_user_id UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(league_id, tournament_id),
  CONSTRAINT league_tournament_links_status_check
    CHECK (status IN ('requested', 'approved', 'rejected', 'removed'))
);

CREATE TABLE IF NOT EXISTS league_tournament_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  fighter_id UUID NOT NULL REFERENCES fighters(id) ON DELETE CASCADE,
  ranking_group_key TEXT NOT NULL,
  final_rank INTEGER NOT NULL,
  league_points INTEGER NOT NULL DEFAULT 0,
  medal TEXT,
  double_hits INTEGER NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(league_id, tournament_id, fighter_id),
  CONSTRAINT league_tournament_results_medal_check
    CHECK (medal IS NULL OR medal IN ('gold', 'silver', 'bronze'))
);

CREATE TABLE IF NOT EXISTS league_rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  ranking_group_key TEXT NOT NULL,
  fighter_id UUID NOT NULL REFERENCES fighters(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  total_points INTEGER NOT NULL DEFAULT 0,
  participation_count INTEGER NOT NULL DEFAULT 0,
  medal_count INTEGER NOT NULL DEFAULT 0,
  double_hits_total INTEGER NOT NULL DEFAULT 0,
  double_hit_average TEXT NOT NULL DEFAULT '0',
  per_tournament JSONB NOT NULL DEFAULT '[]'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(league_id, ranking_group_key, fighter_id)
);

CREATE INDEX IF NOT EXISTS leagues_season_visibility_idx
  ON leagues(season_year, public_visibility, status);
CREATE INDEX IF NOT EXISTS league_tournament_links_tournament_idx
  ON league_tournament_links(tournament_id, status);
CREATE INDEX IF NOT EXISTS league_tournament_results_group_idx
  ON league_tournament_results(league_id, ranking_group_key);
CREATE INDEX IF NOT EXISTS league_rankings_group_idx
  ON league_rankings(league_id, ranking_group_key, rank);

ALTER TABLE leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_organization_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_tournament_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_tournament_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_rankings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION has_league_user_role(target_league_id UUID, min_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM league_user_roles
    WHERE league_id = target_league_id
      AND user_id = auth.uid()
      AND CASE min_role
        WHEN 'admin' THEN role IN ('admin', 'owner')
        WHEN 'owner' THEN role = 'owner'
        ELSE FALSE
      END
  );
$$;

CREATE OR REPLACE FUNCTION has_league_org_role(target_league_id UUID, min_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM league_organization_roles lor
    JOIN organization_members om ON om.organization_id = lor.organization_id
    WHERE lor.league_id = target_league_id
      AND om.user_id = auth.uid()
      AND CASE min_role
        WHEN 'member' THEN lor.role IN ('member', 'admin', 'owner')
        WHEN 'admin' THEN lor.role IN ('admin', 'owner') AND om.role IN ('admin', 'owner')
        WHEN 'owner' THEN lor.role = 'owner' AND om.role = 'owner'
        ELSE FALSE
      END
  );
$$;

CREATE OR REPLACE FUNCTION can_manage_league(target_league_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT is_super_admin()
    OR has_league_user_role(target_league_id, 'admin')
    OR has_league_org_role(target_league_id, 'admin');
$$;

CREATE POLICY "leagues_public_select" ON leagues FOR SELECT
  USING (public_visibility OR can_manage_league(id));
CREATE POLICY "leagues_insert" ON leagues FOR INSERT
  WITH CHECK (is_super_admin() OR auth.uid() IS NOT NULL);
CREATE POLICY "leagues_update" ON leagues FOR UPDATE
  USING (can_manage_league(id))
  WITH CHECK (can_manage_league(id));

CREATE POLICY "league_org_roles_select" ON league_organization_roles FOR SELECT
  USING (can_manage_league(league_id));
CREATE POLICY "league_org_roles_all" ON league_organization_roles FOR ALL
  USING (can_manage_league(league_id))
  WITH CHECK (can_manage_league(league_id));

CREATE POLICY "league_user_roles_select" ON league_user_roles FOR SELECT
  USING (can_manage_league(league_id) OR user_id = auth.uid());
CREATE POLICY "league_user_roles_all" ON league_user_roles FOR ALL
  USING (can_manage_league(league_id))
  WITH CHECK (can_manage_league(league_id));

CREATE POLICY "league_links_select" ON league_tournament_links FOR SELECT
  USING (
    can_manage_league(league_id)
    OR is_org_member(event_org_id((SELECT event_id FROM tournaments WHERE id = tournament_id)))
  );
CREATE POLICY "league_links_all" ON league_tournament_links FOR ALL
  USING (
    can_manage_league(league_id)
    OR has_org_role(event_org_id((SELECT event_id FROM tournaments WHERE id = tournament_id)), 'admin')
  )
  WITH CHECK (
    can_manage_league(league_id)
    OR has_org_role(event_org_id((SELECT event_id FROM tournaments WHERE id = tournament_id)), 'admin')
  );

CREATE POLICY "league_results_select" ON league_tournament_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = league_tournament_results.league_id
        AND leagues.public_visibility = TRUE
    )
    OR can_manage_league(league_id)
  );
CREATE POLICY "league_results_all" ON league_tournament_results FOR ALL
  USING (can_manage_league(league_id))
  WITH CHECK (can_manage_league(league_id));

CREATE POLICY "league_rankings_select" ON league_rankings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM leagues
      WHERE leagues.id = league_rankings.league_id
        AND leagues.public_visibility = TRUE
    )
    OR can_manage_league(league_id)
  );
CREATE POLICY "league_rankings_all" ON league_rankings FOR ALL
  USING (can_manage_league(league_id))
  WITH CHECK (can_manage_league(league_id));
