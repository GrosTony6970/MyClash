-- T-1209: Referee financial compensation
-- Plans (org-owned or built-in), role rates, tiers, per-event settings, payment tracking

-- ── Plans ─────────────────────────────────────────────────────────────────────
CREATE TABLE referee_compensation_plans (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  built_in         BOOLEAN NOT NULL DEFAULT false,
  public_visibility BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rcp_organization ON referee_compensation_plans(organization_id);
ALTER TABLE referee_compensation_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rcp_read" ON referee_compensation_plans FOR SELECT
  USING (
    built_in
    OR public_visibility
    OR organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "rcp_write" ON referee_compensation_plans FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = (SELECT auth.uid()) AND role IN ('owner','admin')
    )
  );

-- ── Token rates per role × compensation phase ─────────────────────────────────
CREATE TABLE referee_compensation_role_rates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id           UUID NOT NULL REFERENCES referee_compensation_plans(id) ON DELETE CASCADE,
  referee_role      TEXT NOT NULL CHECK (referee_role IN ('arbitre_declarant','arbitre_assesseur','arbitre_table')),
  compensation_phase TEXT NOT NULL CHECK (compensation_phase IN ('pool','bracket','finals')),
  tokens_per_match  NUMERIC(6,2) NOT NULL DEFAULT 0,
  UNIQUE (plan_id, referee_role, compensation_phase)
);
CREATE INDEX idx_rcrr_plan ON referee_compensation_role_rates(plan_id);
ALTER TABLE referee_compensation_role_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rcrr_read" ON referee_compensation_role_rates FOR SELECT USING (
  plan_id IN (
    SELECT id FROM referee_compensation_plans
    WHERE built_in OR public_visibility
      OR organization_id IN (
        SELECT organization_id FROM organization_members
        WHERE user_id = (SELECT auth.uid())
      )
  )
);

CREATE POLICY "rcrr_write" ON referee_compensation_role_rates FOR ALL USING (
  plan_id IN (
    SELECT id FROM referee_compensation_plans
    WHERE organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = (SELECT auth.uid()) AND role IN ('owner','admin')
    )
  )
);

-- ── Token→money conversion tiers ──────────────────────────────────────────────
CREATE TABLE referee_compensation_tiers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id      UUID NOT NULL REFERENCES referee_compensation_plans(id) ON DELETE CASCADE,
  min_tokens   NUMERIC(6,2) NOT NULL,
  max_tokens   NUMERIC(6,2),            -- NULL = no upper bound (last tier)
  amount       NUMERIC(10,2) NOT NULL,
  UNIQUE (plan_id, min_tokens)
);
CREATE INDEX idx_rct_plan ON referee_compensation_tiers(plan_id);
ALTER TABLE referee_compensation_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rct_read" ON referee_compensation_tiers FOR SELECT USING (
  plan_id IN (
    SELECT id FROM referee_compensation_plans
    WHERE built_in OR public_visibility
      OR organization_id IN (
        SELECT organization_id FROM organization_members
        WHERE user_id = (SELECT auth.uid())
      )
  )
);

CREATE POLICY "rct_write" ON referee_compensation_tiers FOR ALL USING (
  plan_id IN (
    SELECT id FROM referee_compensation_plans
    WHERE organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = (SELECT auth.uid()) AND role IN ('owner','admin')
    )
  )
);

-- ── Per-event settings ────────────────────────────────────────────────────────
CREATE TABLE referee_compensation_event_settings (
  event_id                UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  plan_id                 UUID NOT NULL REFERENCES referee_compensation_plans(id),
  max_compensation_amount NUMERIC(10,2),   -- NULL = no cap
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rces_plan ON referee_compensation_event_settings(plan_id);
ALTER TABLE referee_compensation_event_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rces_read" ON referee_compensation_event_settings FOR SELECT USING (
  event_id IN (
    SELECT id FROM events
    WHERE organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = (SELECT auth.uid())
    )
  )
);

CREATE POLICY "rces_write" ON referee_compensation_event_settings FOR ALL USING (
  event_id IN (
    SELECT id FROM events
    WHERE organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = (SELECT auth.uid()) AND role IN ('owner','admin')
    )
  )
);

-- ── Payment tracking ──────────────────────────────────────────────────────────
-- user_id matches referee_assignments.user_id (Supabase auth user)
CREATE TABLE referee_compensation_payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL,
  tokens_earned NUMERIC(6,2) NOT NULL,
  amount_owed   NUMERIC(10,2) NOT NULL,
  paid          BOOLEAN NOT NULL DEFAULT false,
  paid_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);
CREATE INDEX idx_rcpay_event  ON referee_compensation_payments(event_id);
CREATE INDEX idx_rcpay_user   ON referee_compensation_payments(user_id);
CREATE INDEX idx_rcpay_unpaid ON referee_compensation_payments(event_id) WHERE paid = false;
ALTER TABLE referee_compensation_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rcpay_read" ON referee_compensation_payments FOR SELECT USING (
  event_id IN (
    SELECT id FROM events
    WHERE organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = (SELECT auth.uid())
    )
  )
);

CREATE POLICY "rcpay_write" ON referee_compensation_payments FOR ALL USING (
  event_id IN (
    SELECT id FROM events
    WHERE organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = (SELECT auth.uid()) AND role IN ('owner','admin')
    )
  )
);

-- ── Seed: FFAMHE built-in plan ────────────────────────────────────────────────
DO $$
DECLARE
  plan_id UUID;
BEGIN
  INSERT INTO referee_compensation_plans (name, description, built_in, public_visibility)
  VALUES (
    'FFAMHE',
    'Plan de compensation officiel FFAMHE (points d''arbitrage)',
    true,
    true
  )
  RETURNING id INTO plan_id;

  -- Role rates (FFAMHE default values — adjust as needed)
  INSERT INTO referee_compensation_role_rates (plan_id, referee_role, compensation_phase, tokens_per_match)
  VALUES
    (plan_id, 'arbitre_declarant', 'pool',    2),
    (plan_id, 'arbitre_declarant', 'bracket', 3),
    (plan_id, 'arbitre_declarant', 'finals',  4),
    (plan_id, 'arbitre_assesseur', 'pool',    1),
    (plan_id, 'arbitre_assesseur', 'bracket', 2),
    (plan_id, 'arbitre_assesseur', 'finals',  3),
    (plan_id, 'arbitre_table',     'pool',    1),
    (plan_id, 'arbitre_table',     'bracket', 1),
    (plan_id, 'arbitre_table',     'finals',  2);

  -- Conversion tiers (FFAMHE example — adjust as needed)
  INSERT INTO referee_compensation_tiers (plan_id, min_tokens, max_tokens, amount)
  VALUES
    (plan_id,  0,  9, 0),
    (plan_id, 10, 19, 10),
    (plan_id, 20, 29, 20),
    (plan_id, 30, 49, 30),
    (plan_id, 50, NULL, 50);
END $$;
