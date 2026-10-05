-- 0220: an account holds one roster row at an Event (operator ruling 296).
--
-- "Which roster row is the caller, at this Event?" is asked by the booking door, by
-- my-schedule and by the pass, and each reads ONE row for the account and the Event. With two
-- rows the read fails: Paul's booking, his schedule and his pass at that Event all answer a
-- server error, and stay so until somebody repairs the rows by hand.
--
-- No writer makes that state today. Every one gives a row to an account only when the row's
-- address is the account's own, and one Event cannot hold one address twice
-- (`persons_event_id_email_key`). That is a fact about today's code, proven by reading it. The
-- index makes it a fact of the table: a future import, merge tool or claim door that tries a
-- second row is refused at its own write, where the fault is, and Paul is never blocked.
--
-- A row no account holds is not counted: its holder is NULL, and in a unique index a NULL equals
-- no other. An Event keeps its many unheld rows, and an account holds one row at each of many
-- Events.
--
-- No row is repaired here. On a database that already holds two rows of one account at one
-- Event this migration fails, and says which: that state needs a person to choose the row.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table, no policy change, no grant. The index refuses a write; it opens no read.

CREATE UNIQUE INDEX IF NOT EXISTS persons_event_id_claimed_by_user_id_key
  ON persons (event_id, claimed_by_user_id);

NOTIFY pgrst, 'reload schema';
