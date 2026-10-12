-- 0222: a bout says when it was last put back in play.
--
-- THE DEFECT. A tablet with no network keeps its clock presses and its round presses in a
-- queue, and sends them later. Meanwhile somebody with a network ends the bout, then puts
-- it back in play: the Reopen button, or the undo of the hit that ended it. The tablet's
-- old "End match" or "End round" then arrives, fits the bout as it reads now, and ends it
-- again with nobody looking (operator, 2026-10-11 and 2026-10-12).
--
-- WHAT CHANGES. `matches.back_in_play_at` is the server's time of the last write that took
-- the bout out of `completed`, or a closed round of a best-of bout back in play. It is
-- written in that same update, so the mark cannot be lost between two writes. A press a
-- tablet sends late is refused when the server's time of the press is not after it
-- (`apps/api/src/modules/matches/press-before-reopen.ts`).
--
-- Nullable, with no default: a bout never put back in play has none, and refuses no press.
-- A reset writes it empty again (`unplayedMatchColumns`).
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- No new table and no policy change. The new column sits on `matches` under its
-- existing row-level security. It is a time, and holds no personal data.

ALTER TABLE matches ADD COLUMN IF NOT EXISTS back_in_play_at TIMESTAMPTZ;

COMMENT ON COLUMN matches.back_in_play_at IS
  'The server''s time of the last write that put this Match, or a closed round of it, back in play; null when none did.';

NOTIFY pgrst, 'reload schema';
