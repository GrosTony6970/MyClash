-- 0239: a forfeit may count as a draw (operator rulings 64, 71, 72, 2026-10-20).
--
-- THE RULE. A penalty ruleset sets, per reason (injury, voluntary withdrawal, conduct), what the
-- bout counts as: the score it stood at, a loss of 0 to X, or now a DRAW. A draw is saved the way a
-- double-hit ceiling draw is: 0-0 with no winner, which every reader of a finished bout already
-- counts as a draw for both Fighters (the Pool table, Swiss points, `compact_fighter_stats`, the
-- pad). It happens on a Pool or Swiss bout only; a bracket bout has no draw, so the API records the
-- reason's loss there. The Pool bouts a withdrawal forfeits with it are draws too (ruling 71).
--
-- WHAT CHANGES on `match_forfeits`.
--   1. `match_forfeits_score_policy_allowed` (0177) is dropped BY NAME, no IF EXISTS: a missing
--      constraint is a broken history and must stop the replay. It comes back with 'draw'.
--   2. `winner_registration_id` may be null: a draw has no winner.
--   3. `match_forfeits_draw_has_no_winner`: a record has no winner exactly when it is a draw. So a
--      draw cannot name a winner, and every other policy (a loss, the score kept, an override)
--      still must.
--   The DO block then reads both CHECKs back by their exact text and the column's nullability.
--
-- No row is written: every record stored today has a winner and is not a draw, so both CHECKs
-- hold on it. The winner key stays NO ACTION DEFERRABLE INITIALLY DEFERRED (0237); a null winner
-- references nothing. 0238 left the table API-only: no web role writes it.

-- A guard: this migration writes no row, so no deferred check is pending. A key of this table is
-- DEFERRED (0237), and an ALTER behind a pending check would fail 55006 if a row were written above.
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE public.match_forfeits DROP CONSTRAINT match_forfeits_score_policy_allowed;
ALTER TABLE public.match_forfeits
  ADD CONSTRAINT match_forfeits_score_policy_allowed
  CHECK (score_policy IN ('keep_current', 'fixed_loss', 'draw', 'explicit'));

ALTER TABLE public.match_forfeits ALTER COLUMN winner_registration_id DROP NOT NULL;
ALTER TABLE public.match_forfeits
  ADD CONSTRAINT match_forfeits_draw_has_no_winner
  CHECK ((score_policy = 'draw') = (winner_registration_id IS NULL));

-- ── Prove what landed ────────────────────────────────────────────────────────
DO $$
DECLARE
  allowed TEXT;
  pairing TEXT;
  stale TEXT;
  nullable TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO allowed FROM pg_constraint
   WHERE conrelid = 'public.match_forfeits'::regclass
     AND conname = 'match_forfeits_score_policy_allowed';
  IF allowed IS DISTINCT FROM
     'CHECK ((score_policy = ANY (ARRAY[''keep_current''::text, ''fixed_loss''::text, ''draw''::text, ''explicit''::text])))'
  THEN
    RAISE EXCEPTION '0239: match_forfeits_score_policy_allowed is %', allowed;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO pairing FROM pg_constraint
   WHERE conrelid = 'public.match_forfeits'::regclass
     AND conname = 'match_forfeits_draw_has_no_winner';
  IF pairing IS DISTINCT FROM
     'CHECK (((score_policy = ''draw''::text) = (winner_registration_id IS NULL)))'
  THEN
    RAISE EXCEPTION '0239: match_forfeits_draw_has_no_winner is %', pairing;
  END IF;

  -- No other CHECK on the policy or the winner: a forgotten one would refuse a draw at runtime.
  SELECT string_agg(conname, ', ') INTO stale FROM pg_constraint
   WHERE conrelid = 'public.match_forfeits'::regclass
     AND contype = 'c'
     AND conname NOT IN ('match_forfeits_score_policy_allowed', 'match_forfeits_draw_has_no_winner')
     AND (pg_get_constraintdef(oid) LIKE '%score_policy%'
          OR pg_get_constraintdef(oid) LIKE '%winner_registration_id%');
  IF stale IS NOT NULL THEN
    RAISE EXCEPTION '0239: match_forfeits still carries CHECK(s) on the policy or the winner: %',
      stale;
  END IF;

  SELECT is_nullable INTO nullable FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'match_forfeits'
     AND column_name = 'winner_registration_id';
  IF nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION '0239: match_forfeits.winner_registration_id is not nullable';
  END IF;
END $$;

COMMENT ON COLUMN public.match_forfeits.score_policy IS
  'How forfeiting_score/opponent_score were arrived at. keep_current, fixed_loss and draw derive from the penalty ruleset per-reason rule (a draw is 0-0 with no winner, on a Pool or Swiss bout); explicit means the caller stated them, and is the only policy an override uses.';
COMMENT ON COLUMN public.match_forfeits.winner_registration_id IS
  'The Fighter the forfeit gives the bout to; null exactly when score_policy is draw (match_forfeits_draw_has_no_winner).';

NOTIFY pgrst, 'reload schema';
