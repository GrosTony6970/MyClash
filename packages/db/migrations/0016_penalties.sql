-- ============================================================
-- MyClash - Penalty Management / Cartons
-- ============================================================

CREATE TABLE IF NOT EXISTS penalty_rulesets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  version TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  owner_organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  built_in BOOLEAN NOT NULL DEFAULT FALSE,
  public_visibility BOOLEAN NOT NULL DEFAULT FALSE,
  accumulation_scope TEXT NOT NULL DEFAULT 'match',
  csv_source_name TEXT,
  csv_source_sha256 TEXT,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(code, version, owner_organization_id),
  CONSTRAINT penalty_rulesets_scope_check CHECK (accumulation_scope IN ('match', 'phase', 'tournament'))
);

CREATE TABLE IF NOT EXISTS penalty_ruleset_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ruleset_id UUID NOT NULL REFERENCES penalty_rulesets(id) ON DELETE CASCADE,
  group_number INTEGER NOT NULL,
  ref_number INTEGER NOT NULL,
  short_name TEXT NOT NULL,
  description TEXT NOT NULL,
  sanctions JSONB NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(ruleset_id, ref_number),
  CONSTRAINT penalty_entries_group_check CHECK (group_number > 0),
  CONSTRAINT penalty_entries_ref_check CHECK (ref_number > 0)
);

CREATE TABLE IF NOT EXISTS match_penalties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_uuid UUID NOT NULL UNIQUE,
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  ruleset_id UUID REFERENCES penalty_rulesets(id) ON DELETE SET NULL,
  ruleset_entry_id UUID REFERENCES penalty_ruleset_entries(id) ON DELETE SET NULL,
  sequence INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'ruleset',
  card TEXT NOT NULL,
  group_number INTEGER,
  ref_number INTEGER,
  short_name TEXT,
  reason TEXT,
  score_delta INTEGER NOT NULL DEFAULT 0,
  causes_match_forfeit BOOLEAN NOT NULL DEFAULT FALSE,
  by_user_id UUID,
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided BOOLEAN NOT NULL DEFAULT FALSE,
  voided_reason TEXT,
  UNIQUE(match_id, sequence),
  CONSTRAINT match_penalties_source_check CHECK (source IN ('ruleset', 'direct')),
  CONSTRAINT match_penalties_card_check CHECK (card IN ('yellow', 'red', 'black'))
);

CREATE TABLE IF NOT EXISTS tournament_penalty_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  review_type TEXT NOT NULL DEFAULT 'second_black_card',
  status TEXT NOT NULL DEFAULT 'pending',
  black_card_count INTEGER NOT NULL DEFAULT 0,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by_user_id UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tournament_id, registration_id, review_type),
  CONSTRAINT tournament_penalty_reviews_type_check CHECK (review_type IN ('second_black_card')),
  CONSTRAINT tournament_penalty_reviews_status_check CHECK (status IN ('pending', 'confirmed', 'dismissed'))
);

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS penalty_ruleset_id UUID REFERENCES penalty_rulesets(id) ON DELETE SET NULL;

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS scoring_config_json JSONB,
  ADD COLUMN IF NOT EXISTS penalty_ruleset_id UUID REFERENCES penalty_rulesets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS penalty_rulesets_owner_idx
  ON penalty_rulesets(owner_organization_id, built_in);
CREATE INDEX IF NOT EXISTS penalty_entries_ruleset_idx
  ON penalty_ruleset_entries(ruleset_id, group_number, ref_number);
CREATE INDEX IF NOT EXISTS match_penalties_match_idx
  ON match_penalties(match_id, voided, sequence);
CREATE INDEX IF NOT EXISTS match_penalties_tournament_registration_idx
  ON match_penalties(tournament_id, registration_id, card, voided);
CREATE INDEX IF NOT EXISTS tournament_penalty_reviews_tournament_idx
  ON tournament_penalty_reviews(tournament_id, status);

ALTER TABLE penalty_rulesets ENABLE ROW LEVEL SECURITY;
ALTER TABLE penalty_ruleset_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_penalties ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_penalty_reviews ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION can_manage_penalty_ruleset(target_ruleset_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM penalty_rulesets pr
      WHERE pr.id = target_ruleset_id
        AND pr.owner_organization_id IS NOT NULL
        AND has_org_role(pr.owner_organization_id, 'admin')
    );
$$;

CREATE OR REPLACE FUNCTION match_penalty_event_org_id(target_match_id UUID)
RETURNS UUID
LANGUAGE sql STABLE
AS $$
  SELECT e.organization_id
  FROM matches m
  JOIN phases p ON p.id = m.phase_id
  JOIN tournaments t ON t.id = p.tournament_id
  JOIN events e ON e.id = t.event_id
  WHERE m.id = target_match_id;
$$;

CREATE POLICY "penalty_rulesets_select" ON penalty_rulesets FOR SELECT
  USING (built_in OR public_visibility OR can_manage_penalty_ruleset(id));
CREATE POLICY "penalty_rulesets_insert" ON penalty_rulesets FOR INSERT
  WITH CHECK (
    is_super_admin()
    OR (
      built_in = FALSE
      AND owner_organization_id IS NOT NULL
      AND has_org_role(owner_organization_id, 'admin')
    )
  );
CREATE POLICY "penalty_rulesets_update" ON penalty_rulesets FOR UPDATE
  USING (built_in = FALSE AND can_manage_penalty_ruleset(id))
  WITH CHECK (built_in = FALSE AND can_manage_penalty_ruleset(id));

CREATE POLICY "penalty_entries_select" ON penalty_ruleset_entries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM penalty_rulesets pr
      WHERE pr.id = ruleset_id
        AND (pr.built_in OR pr.public_visibility OR can_manage_penalty_ruleset(pr.id))
    )
  );
CREATE POLICY "penalty_entries_all" ON penalty_ruleset_entries FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM penalty_rulesets pr
      WHERE pr.id = ruleset_id
        AND pr.built_in = FALSE
        AND can_manage_penalty_ruleset(pr.id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM penalty_rulesets pr
      WHERE pr.id = ruleset_id
        AND pr.built_in = FALSE
        AND can_manage_penalty_ruleset(pr.id)
    )
  );

CREATE POLICY "match_penalties_select" ON match_penalties FOR SELECT
  USING (
    is_org_member(match_penalty_event_org_id(match_id))
    OR EXISTS (
      SELECT 1
      FROM matches m
      JOIN phases p ON p.id = m.phase_id
      JOIN tournaments t ON t.id = p.tournament_id
      JOIN events e ON e.id = t.event_id
      WHERE m.id = match_id
        AND e.status IN ('published', 'running', 'completed')
    )
  );
CREATE POLICY "match_penalties_all" ON match_penalties FOR ALL
  USING (has_org_role(match_penalty_event_org_id(match_id), 'scorekeeper'))
  WITH CHECK (has_org_role(match_penalty_event_org_id(match_id), 'scorekeeper'));

CREATE POLICY "tournament_penalty_reviews_select" ON tournament_penalty_reviews FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM tournaments t
      WHERE t.id = tournament_id
        AND is_org_member(event_org_id(t.event_id))
    )
  );
CREATE POLICY "tournament_penalty_reviews_all" ON tournament_penalty_reviews FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM tournaments t
      WHERE t.id = tournament_id
        AND has_org_role(event_org_id(t.event_id), 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM tournaments t
      WHERE t.id = tournament_id
        AND has_org_role(event_org_id(t.event_id), 'admin')
    )
  );
