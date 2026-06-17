-- 0099_event_instructors.sql
--
-- Event-scoped instructor roster — tag a person as an instructor FOR
-- THIS EVENT, mirroring event_referees. Unlike referees this is a
-- deliberate asymmetry: there is NO global is_instructor flag on
-- global_persons. Tagging/untagging only ever touches this table.
--
-- person_id references global_persons(id) (the unified identity used by
-- event_referees post-0063); the API resolves an event-scoped
-- persons.id → global_person_id before inserting here.

CREATE TABLE IF NOT EXISTS event_instructors (
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  person_id  UUID NOT NULL REFERENCES global_persons(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_event_instructors_person ON event_instructors(person_id);

ALTER TABLE event_instructors ENABLE ROW LEVEL SECURITY;

-- Read: any member of the owning org (and super-admins). Write: admin+
-- on the owning org. The API uses the service key (RLS-bypassing) and
-- enforces workshop_lead+ in-service; these policies are defense-in-depth
-- for any direct PostgREST access.
CREATE POLICY "event_instructors_select" ON event_instructors FOR SELECT
  USING (is_super_admin() OR is_org_member(event_org_id(event_id)));

CREATE POLICY "event_instructors_write" ON event_instructors FOR ALL
  USING (is_super_admin() OR has_org_role(event_org_id(event_id), 'admin'));

NOTIFY pgrst, 'reload schema';
