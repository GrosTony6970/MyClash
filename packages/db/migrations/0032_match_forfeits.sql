CREATE TABLE IF NOT EXISTS match_forfeits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  forfeiting_registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE RESTRICT,
  winner_registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (reason IN ('injury', 'voluntary', 'black_card_1', 'black_card_2', 'conduct_violation')),
  score_policy TEXT NOT NULL CHECK (score_policy IN ('keep_current', 'fixed_loss')),
  forfeiting_score INTEGER,
  opponent_score INTEGER,
  can_continue BOOLEAN,
  auto_created BOOLEAN NOT NULL DEFAULT FALSE,
  parent_forfeit_id UUID REFERENCES match_forfeits(id) ON DELETE SET NULL,
  replacement_registration_id UUID REFERENCES registrations(id) ON DELETE SET NULL,
  previous_match_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  previous_registration_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  downstream_match_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  note TEXT,
  by_user_id UUID,
  staff_account_id UUID,
  voided_at TIMESTAMPTZ,
  voided_by_user_id UUID,
  voided_by_staff_account_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS match_forfeits_one_active_per_match
  ON match_forfeits(match_id)
  WHERE voided_at IS NULL;

CREATE INDEX IF NOT EXISTS match_forfeits_tournament_idx
  ON match_forfeits(tournament_id, forfeiting_registration_id)
  WHERE voided_at IS NULL;

ALTER TABLE match_forfeits ENABLE ROW LEVEL SECURITY;

CREATE POLICY match_forfeits_service_all
  ON match_forfeits
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
