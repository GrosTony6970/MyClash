-- Event-scoped local staff accounts for scoring tablets.
-- Staff auth is handled by the API mc_staff cookie, not Supabase Auth.

CREATE TABLE IF NOT EXISTS event_staff_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  username TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'arbitre_table'
    CHECK (role IN ('arbitre_table', 'event_staff')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_by_user_id UUID,
  disabled_by_user_id UUID,
  disabled_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_staff_accounts_event_username
  ON event_staff_accounts(event_id, lower(username));
CREATE INDEX IF NOT EXISTS idx_event_staff_accounts_event
  ON event_staff_accounts(event_id);

CREATE TABLE IF NOT EXISTS event_staff_lice_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  staff_account_id UUID NOT NULL REFERENCES event_staff_accounts(id) ON DELETE CASCADE,
  lice_id UUID NOT NULL REFERENCES lices(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(staff_account_id, lice_id)
);

CREATE INDEX IF NOT EXISTS idx_event_staff_lice_assignments_staff
  ON event_staff_lice_assignments(staff_account_id);
CREATE INDEX IF NOT EXISTS idx_event_staff_lice_assignments_lice
  ON event_staff_lice_assignments(lice_id);

ALTER TABLE match_events
  ADD COLUMN IF NOT EXISTS staff_account_id UUID REFERENCES event_staff_accounts(id) ON DELETE SET NULL;

ALTER TABLE exchanges
  ADD COLUMN IF NOT EXISTS staff_account_id UUID REFERENCES event_staff_accounts(id) ON DELETE SET NULL;

ALTER TABLE match_penalties
  ADD COLUMN IF NOT EXISTS staff_account_id UUID REFERENCES event_staff_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_match_events_staff_account
  ON match_events(staff_account_id);
CREATE INDEX IF NOT EXISTS idx_exchanges_staff_account
  ON exchanges(staff_account_id);
CREATE INDEX IF NOT EXISTS idx_match_penalties_staff_account
  ON match_penalties(staff_account_id);

ALTER TABLE event_staff_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_staff_lice_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org editors manage event staff accounts"
  ON event_staff_accounts
  FOR ALL
  USING (
    has_org_role(
      (SELECT organization_id FROM events WHERE events.id = event_staff_accounts.event_id),
      'editor'
    )
  )
  WITH CHECK (
    has_org_role(
      (SELECT organization_id FROM events WHERE events.id = event_staff_accounts.event_id),
      'editor'
    )
  );

CREATE POLICY "Org editors manage event staff lice assignments"
  ON event_staff_lice_assignments
  FOR ALL
  USING (
    has_org_role(
      (SELECT organization_id FROM events WHERE events.id = event_staff_lice_assignments.event_id),
      'editor'
    )
  )
  WITH CHECK (
    has_org_role(
      (SELECT organization_id FROM events WHERE events.id = event_staff_lice_assignments.event_id),
      'editor'
    )
  );
