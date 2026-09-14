-- 0195: the Event keeps the planner's sheet.
--
-- THE DEFECT. The planner's numbers (the day's bounds, the midday break, the four bout
-- lengths, the gap, the rest, the admin blocks) were a constant in the browser. They
-- were sent with each Suggest and forgotten when the page reloaded. Nothing stored them,
-- so every screen that needs a bout length guessed its own, and the guesses disagreed
-- (ADR-017).
--
-- WHAT CHANGES. One row per Event holds the sheet (ADR-018). `config_json` is validated
-- by `programmeConfigSchema` in apps/api/src/modules/programme/dto/programme.dto.ts,
-- which is also the one owner of the defaults: a missing row, or a row missing a field,
-- reads as those defaults. The sheet holds the Event's four bout lengths and, optionally,
-- the same four for a Tournament, as an array of rows each naming its Tournament. It is
-- an array and not an object keyed by Tournament id because the organizer archive can
-- remap an id found at a path, never an object key; a keyed object would keep pointing
-- at the source Event's Tournaments in a restored copy.
--
-- The sheet is its own table rather than a column on `events` because the public events
-- list selects every column of the event row, and the sheet has no business in a
-- public payload.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- Row-level security with the same two policies as the bars in
-- event_programme_blocks (0028): any member of the Event's organization may read, an
-- owner or admin may write. The API reads and writes through the service-role client,
-- which is BYPASSRLS, and authorises in ProgrammeService: anyone signed in who can see
-- the Event may read the sheet, the organiser's team may write it. Without RLS the
-- table would be world-readable, because PostgREST exposes the public schema as anon.

CREATE TABLE IF NOT EXISTS event_programme_configs (
  event_id    UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  config_json JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE event_programme_configs IS
  'The planner sheet: one row per Event, validated by programmeConfigSchema (ADR-018).';

ALTER TABLE event_programme_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "epc_read" ON event_programme_configs FOR SELECT USING (
  event_id IN (
    SELECT id FROM events WHERE organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = (SELECT auth.uid())
    )
  )
);

CREATE POLICY "epc_write" ON event_programme_configs FOR ALL USING (
  event_id IN (
    SELECT id FROM events WHERE organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = (SELECT auth.uid()) AND role IN ('owner', 'admin')
    )
  )
);

NOTIFY pgrst, 'reload schema';
