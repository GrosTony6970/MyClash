-- 0177_match_forfeits_override_reasons.sql
--
-- Let `match_forfeits` hold a result OVERRIDE as well as a forfeit.
--
-- ## Why this table and not a new one
--
-- `match_forfeits` already overrides a result safely: a side table, a
-- `previous_match_state` + `previous_registration_state` snapshot, a void path
-- that restores them and refuses once a dependent match has started, an
-- `end_reason` on the match, and a recorded actor. A parallel
-- `match_overrides` table would duplicate every one of those, and give
-- standings, exports, HEMA Ratings and archive coverage a second writer to
-- learn about. Exactly one override writer, exactly one void path.
--
-- The accepted cost is the name: "forfeit" is now slightly wrong for what this
-- table holds. That is cheaper than two writers.
--
-- ## The three new reasons are NOT forfeits
--
-- Nobody stopped fighting. `@myclash/rulesets` owns the distinction
-- (FORFEIT_REASONS / OVERRIDE_REASONS / isOverrideReason), and every read that
-- counts forfeits — the standings F column, the DQ counters, the HEMA Ratings
-- exclusion — filters to the forfeit half. A read that forgets the filter
-- silently mis-reports a correction as a forfeit, which is why the API keeps
-- that list in one place rather than repeating a literal per query.
--
-- ## score_policy 'explicit'
--
-- A forfeit derives its scores from the ruleset's per-reason policy
-- (keep_current or fixed_loss). A correction cannot: it exists precisely to
-- state a result the derivation got wrong, so the two scores come from the
-- caller and land in the `forfeiting_score` / `opponent_score` columns that
-- already exist. No new columns.
--
-- ## Dropping the old CHECKs
--
-- 0032 declared both constraints INLINE, so Postgres named them itself. A
-- DROP CONSTRAINT on a guessed name fails silently on a wrong guess, so both
-- are located by the column they constrain (pg_constraint.conkey against
-- pg_attribute.attnum) rather than by a name anyone typed. The replacements
-- are named explicitly, so the next migration can drop them without this dance.

-- ── 1. reason ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  ck_name TEXT;
BEGIN
  FOR ck_name IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'match_forfeits'
       AND t.relnamespace = 'public'::regnamespace
       AND c.contype = 'c'
       AND c.conkey = ARRAY[
             (SELECT a.attnum FROM pg_attribute a
               WHERE a.attrelid = t.oid AND a.attname = 'reason')
           ]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE match_forfeits DROP CONSTRAINT %I', ck_name);
  END LOOP;
END $$;

ALTER TABLE match_forfeits
  DROP CONSTRAINT IF EXISTS match_forfeits_reason_allowed;
ALTER TABLE match_forfeits
  ADD CONSTRAINT match_forfeits_reason_allowed
  CHECK (reason IN (
    -- forfeits: a fighter stopped fighting
    'injury', 'voluntary', 'black_card_1', 'black_card_2', 'conduct_violation',
    -- overrides: the recorded result was wrong
    'referee_decision', 'admin_correction', 'technical_failure'
  ));

-- ── 2. score_policy ──────────────────────────────────────────────────────────
DO $$
DECLARE
  ck_name TEXT;
BEGIN
  FOR ck_name IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'match_forfeits'
       AND t.relnamespace = 'public'::regnamespace
       AND c.contype = 'c'
       AND c.conkey = ARRAY[
             (SELECT a.attnum FROM pg_attribute a
               WHERE a.attrelid = t.oid AND a.attname = 'score_policy')
           ]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE match_forfeits DROP CONSTRAINT %I', ck_name);
  END LOOP;
END $$;

ALTER TABLE match_forfeits
  DROP CONSTRAINT IF EXISTS match_forfeits_score_policy_allowed;
ALTER TABLE match_forfeits
  ADD CONSTRAINT match_forfeits_score_policy_allowed
  CHECK (score_policy IN ('keep_current', 'fixed_loss', 'explicit'));

-- ── 3. Prove the drops landed ────────────────────────────────────────────────
--
-- The whole failure mode this migration guards against is a DROP that matched
-- nothing: the old CHECK survives, the new one is added beside it, and both
-- apply — so the first override INSERT is refused by a constraint nobody
-- remembers, at runtime, on an event day. If a lookup above missed, fail HERE
-- and loudly instead.
DO $$
DECLARE
  stale TEXT;
BEGIN
  SELECT string_agg(c.conname, ', ')
    INTO stale
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'match_forfeits'
     AND t.relnamespace = 'public'::regnamespace
     AND c.contype = 'c'
     AND c.conname NOT IN (
       'match_forfeits_reason_allowed',
       'match_forfeits_score_policy_allowed'
     )
     AND (
       pg_get_constraintdef(c.oid) LIKE '%reason%'
       OR pg_get_constraintdef(c.oid) LIKE '%score_policy%'
     );

  IF stale IS NOT NULL THEN
    RAISE EXCEPTION
      'match_forfeits still carries CHECK(s) on reason/score_policy that 0177 failed to drop: %',
      stale;
  END IF;
END $$;

COMMENT ON TABLE match_forfeits IS
  'One recorded deviation from a derived match result. Two kinds, told apart by `reason`: a FORFEIT (a fighter stopped fighting) or an OVERRIDE (the recorded result was wrong). @myclash/rulesets owns the split - reads that count forfeits must filter to FORFEIT_REASONS or they will count corrections too.';
COMMENT ON COLUMN match_forfeits.reason IS
  'Forfeit: injury | voluntary | black_card_1 | black_card_2 | conduct_violation. Override: referee_decision | admin_correction | technical_failure.';
COMMENT ON COLUMN match_forfeits.score_policy IS
  'How forfeiting_score/opponent_score were arrived at. keep_current and fixed_loss derive from the ruleset per-reason policy; explicit means the caller stated them, and is the only policy an override uses.';

NOTIFY pgrst, 'reload schema';
