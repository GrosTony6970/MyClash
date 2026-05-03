CREATE INDEX IF NOT EXISTS audit_log_created_at_idx
  ON audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_action_entity_created_idx
  ON audit_log (action, entity_type, created_at DESC);
