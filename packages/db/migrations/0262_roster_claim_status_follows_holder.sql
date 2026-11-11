-- 0262: a roster row says "claimed" exactly when an account holds it (operator ruling 580).
--
-- A roster row carries two marks: its status (`claim_status`) and the account that holds it
-- (`claimed_by_user_id`). The doors that give a row to an account read them differently. The
-- emailed claim link and the Google claim refused a row whose status said "claimed" while nobody
-- held it; "This is me", joining an Event from a Workshop page and the profile back-fill took
-- that same row. Tom, refused by his link, could press "This is me" and get the row.
--
-- No writer makes that row today. Since 0247 only the API writes roster rows, and every API
-- writer sets both marks together. That is a fact about today's code. The CHECK makes it a fact
-- of the table: the holder decides, and a status that disagrees with it is refused at its own
-- write, where the fault is. Every door then asks the holder only.
--
-- The repair runs first, by the same rule: a held row is "claimed", and a "claimed" row nobody
-- holds is "unclaimed". Unlike 0220, no person needs to choose anything here, so the deploy
-- repairs instead of failing. Each repair that changes a row says how many in the deploy log.
--
-- Both sides of the CHECK are never NULL: `claim_status` is NOT NULL (0001), and IS NOT NULL is a
-- boolean. A NULL would let a CHECK pass.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table, no policy change, no grant. The CHECK refuses a write; it opens no read.

DO $$
DECLARE
  n integer;
BEGIN
  UPDATE persons SET claim_status = 'claimed'
   WHERE claimed_by_user_id IS NOT NULL AND claim_status <> 'claimed';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE '0262: % held roster rows now say claimed', n;
  END IF;

  UPDATE persons SET claim_status = 'unclaimed'
   WHERE claimed_by_user_id IS NULL AND claim_status = 'claimed';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE '0262: % claimed roster rows with no holder now say unclaimed', n;
  END IF;
END $$;

ALTER TABLE persons
  ADD CONSTRAINT persons_claim_status_holder_check
  CHECK ((claim_status = 'claimed') = (claimed_by_user_id IS NOT NULL));

NOTIFY pgrst, 'reload schema';
