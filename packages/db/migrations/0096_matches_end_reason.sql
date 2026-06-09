-- 0096_matches_end_reason.sql
--
-- Persist WHY a match ended, so the referee pad and the external
-- scoreboard can show the right result without re-deriving it.
--
-- `recomputeMatchScore` already closes a match when the ruleset reports
-- it is over (`isMatchOver`), and it knows the reason:
--   'first_to_points' — a fighter reached the point cap (has a winner)
--   'max_doubles'      — the double cap was hit (DOUBLE LOSS, no winner,
--                        both scores zeroed)
--   'time_limit'       — clock ran out
-- but it threw the reason away. Without it the TV display can only infer
-- a winner from the scores, and a 0-0 double loss is indistinguishable
-- from a genuine tie. Store the reason so "DOUBLE LOSS" can render.
--
-- Nullable: pre-existing matches and matches ended manually (referee
-- clock 'end', forfeit) keep it null; the TV then falls back to the
-- score-derived winner.

BEGIN;

ALTER TABLE matches ADD COLUMN IF NOT EXISTS end_reason TEXT;

NOTIFY pgrst, 'reload schema';

COMMIT;
