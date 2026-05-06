-- ============================================================
-- MyClash - Organizer event broadcast notifications
-- ============================================================

CREATE TABLE IF NOT EXISTS event_broadcast_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  actor_user_id   UUID NOT NULL,
  severity        TEXT NOT NULL,
  target_type     TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT event_broadcast_severity_check CHECK (severity IN ('info','warning','alert')),
  CONSTRAINT event_broadcast_target_type_check CHECK (
    target_type IN ('all','fighters','referees','specific_persons')
  )
);

CREATE TABLE IF NOT EXISTS event_broadcast_recipients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id    UUID NOT NULL REFERENCES event_broadcast_notifications(id) ON DELETE CASCADE,
  person_id       UUID REFERENCES persons(id) ON DELETE SET NULL,
  user_id         UUID,
  email           TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'queued',
  delivered_at    TIMESTAMPTZ,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT event_broadcast_delivery_status_check CHECK (
    delivery_status IN ('queued','delivered','failed')
  )
);

CREATE INDEX IF NOT EXISTS event_broadcast_notifications_event_created_idx
  ON event_broadcast_notifications (event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS event_broadcast_recipients_broadcast_idx
  ON event_broadcast_recipients (broadcast_id);

CREATE INDEX IF NOT EXISTS event_broadcast_recipients_user_created_idx
  ON event_broadcast_recipients (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

ALTER TABLE event_broadcast_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_broadcast_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_broadcast_notifications_select" ON event_broadcast_notifications
  FOR SELECT USING (
    is_super_admin()
    OR is_org_member(event_org_id(event_id))
  );

CREATE POLICY "event_broadcast_recipients_select" ON event_broadcast_recipients
  FOR SELECT USING (
    is_super_admin()
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM event_broadcast_notifications b
      WHERE b.id = event_broadcast_recipients.broadcast_id
        AND is_org_member(event_org_id(b.event_id))
    )
  );

-- Writes go through NestJS service_role only; no authenticated INSERT/UPDATE policies.
