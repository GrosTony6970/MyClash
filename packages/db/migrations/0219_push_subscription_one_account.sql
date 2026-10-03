-- 0219: one push address, one account (operator ruling 238).
--
-- Anna turns phone alerts on at the club's laptop and signs out. Ben signs in on the same
-- browser and turns alerts on. The browser has ONE push address, and it was saved under both
-- accounts: the save removed only the caller's own row of that address, then inserted. So
-- Anna's alerts kept showing on the laptop while Ben used it.
--
-- An address is a browser's, so it belongs to the account that last turned alerts on there. The
-- unique index makes that a fact of the table, and lets the API save in one write
-- (`ON CONFLICT (endpoint)`): the address moves to the caller.
--
-- Rows that already share an address: the newest stays. It is the account that turned alerts
-- on last in that browser.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table, no policy change. `push_subscriptions_select` / `_write` (0002) still hold an
-- account to its own rows through PostgREST: a signed-in caller cannot read or update another
-- account's row, and an insert of an address somebody else holds now fails on the index instead
-- of adding a second row. The move itself is the API's, as the service role, for a caller who
-- holds the address.

DELETE FROM push_subscriptions older
USING push_subscriptions newer
WHERE older.endpoint = newer.endpoint
  AND (older.created_at, older.id) < (newer.created_at, newer.id);

CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_key
  ON push_subscriptions (endpoint);

NOTIFY pgrst, 'reload schema';
