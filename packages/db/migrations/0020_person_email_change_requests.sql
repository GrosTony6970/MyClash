CREATE TABLE IF NOT EXISTS person_email_change_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  old_email    TEXT NOT NULL,
  new_email    TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS person_email_change_requests_active_user_idx
  ON person_email_change_requests (user_id)
  WHERE confirmed_at IS NULL AND cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS person_email_change_requests_user_created_idx
  ON person_email_change_requests (user_id, created_at DESC);

ALTER TABLE person_email_change_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "person_email_change_requests_select_own"
  ON person_email_change_requests FOR SELECT
  USING (is_super_admin() OR user_id = auth.uid());
