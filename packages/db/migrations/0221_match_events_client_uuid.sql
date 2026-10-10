-- 0221: a clock press has an id (the offline bout, operator rulings 11 to 14 of 2026-10-09).
--
-- A table has no wifi for an hour. The official starts the clock, stops it, scores, and ends
-- the bout. The tablet keeps each press in its queue and sends them when the network is back.
-- One send reaches the server and its answer is lost, so the tablet sends that press again.
-- A hit is safe there: it carries an id the tablet made (`exchanges.client_uuid`), and the
-- server answers the second send with the saved row. A clock press had no id, so the second
-- send was a second press.
--
-- `client_uuid` is that id. It is empty for every row the server writes by itself (a round
-- that closes, a reset, a press from a pad of before), and unique where it is set. The API
-- reads it before every rule, and the index also settles two sends that arrive together.
--
-- A partial index: most rows of this table are the server's own, and hold no id.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table, no policy change. `match_events_select` (0200) lets the public read the rows
-- of a bout it may see, and the table is in the realtime publication (0004): the new column is
-- read with them. It holds a random id and nothing else. No time of a tablet is stored. Writes
-- stay with the API, as the service role.

ALTER TABLE match_events ADD COLUMN IF NOT EXISTS client_uuid UUID;

CREATE UNIQUE INDEX IF NOT EXISTS match_events_client_uuid_key
  ON match_events (client_uuid)
  WHERE client_uuid IS NOT NULL;

NOTIFY pgrst, 'reload schema';
