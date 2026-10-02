-- 0218: a hub follow carries one switch, "notify when refereeing" (rulings 217, 217a, 217b).
--
-- Marc follows Paul from the People hub. Paul referees at an Event, taken from the directory: he
-- has no roster row there. A follower's referee alert was looked up through the roster rows of
-- the Event only, so nothing could ring for Marc, and Paul's card had no switch to ask for it:
-- the three switches of a card sit on a follow of ONE Event (`follows`).
--
-- `directory_follows.notify_referee_start` is that switch, on the hub follow itself. It covers
-- every Event where the follower has no Event follow of that person; where he has one, that
-- Event's own switch decides (`follows.notify_referee_start`).
--
-- Off at first (ruling 217a), as the same switch of an Event follow is. The default is the safe
-- value: a path that inserts a hub follow and forgets the column asks for no alert.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table, no policy change. `directory_follows_owner_all` (0122) already lets an account
-- read and write its own hub follows and nobody else's, so the owner can set the switch through
-- PostgREST too. Such a write skips the API's alert work; the saved switch is read again when an
-- alert fires.
--
-- A merge moves a hub follow by its profile id (`merge_fighters`, 0212), so the switch moves with
-- it; when the follower follows both profiles, the survivor's follow keeps its own switch.
--
-- No IF NOT EXISTS: a column that is already there must fail the replay, not pass it.

ALTER TABLE directory_follows
  ADD COLUMN notify_referee_start BOOLEAN NOT NULL DEFAULT FALSE;

NOTIFY pgrst, 'reload schema';
