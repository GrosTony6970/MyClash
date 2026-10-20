-- 0235: every forfeit rule lives in the penalty ruleset (operator rulings 63-76, 2026-10-20).
--
-- THE DEFECT. Five places answered "what does a forfeit do": a hidden table in the scoring
-- ruleset (`forfeitPolicy`), three switches only TF_v1 Tournaments had (`tournamentPolicy`), the
-- penalty ruleset's black-card columns, three hand-forfeit screens, and a "counts as draw" switch
-- that changed only the Pool W/D/L columns. A club-scoring Tournament got the hidden defaults and
-- never saw the switches.
--
-- WHAT CHANGES.
--   1. `penalty_rulesets.forfeit_rules`: per reason (injury, voluntary, conduct) what the bout
--      counts as and what happens to the Fighter; "disqualify after N" (1-10 or 'off'); "a forfeit
--      before the 1st bout disqualifies"; a black card forfeit's 0-X loss. Its shape is checked by
--      the API (`ForfeitRulesSchema`); the column holds an object. The DEFAULT is a brand-new club
--      ruleset's start: "disqualify after" off (ruling 67). Both literals below are compared with
--      the TypeScript start values by `forfeit-rules.migration-parity.test.ts`.
--   2. The built-in FFAMHE row takes today's TF_v1 behaviour, "disqualify after 2" included.
--   3. `penalty_ruleset_versions.forfeit_rules`: a published snapshot keeps the rules too. Each
--      snapshot takes its ruleset's, then the column has no DEFAULT: every writer says it.
--   4. `forfeitPolicy` and `tournamentPolicy` are stripped from `tournaments.ruleset_config` and
--      `custom_rulesets.tf_config`. No value moves (ruling 74): the stack is wiped at this deploy.
--      `match_rules.ruleset_config` is not stripped: its rows cannot change (0229's trigger), the
--      stack holds none, and every reader parses it with a schema that drops unknown keys.
--
-- THE DEPLOY WINDOW. The old API's version snapshot (`buildPenaltyVersionRow`) names no
-- `forfeit_rules`, so after step 3 its publish of a penalty ruleset fails NOT NULL, and the
-- freeze that runs on a pin hides that failure. The operator wipes the stack before the deploy.

ALTER TABLE public.penalty_rulesets
  ADD COLUMN forfeit_rules jsonb NOT NULL
    DEFAULT '{"reasons":{"injury":{"outcome":"keep_current","opponentScore":6,"fighter":"asks"},"voluntary":{"outcome":"fixed_loss","opponentScore":6,"fighter":"asks"},"conduct_violation":{"outcome":"fixed_loss","opponentScore":6,"fighter":"disqualified"}},"disqualifyAfter":"off","disqualifyBeforeFirstBout":false,"blackCardOpponentScore":6}'::jsonb -- literal: club_start_forfeit_rules
    CONSTRAINT penalty_rulesets_forfeit_rules_object CHECK (jsonb_typeof(forfeit_rules) = 'object');

DO $$
DECLARE
  n integer;
BEGIN
  UPDATE public.penalty_rulesets
     SET forfeit_rules = '{"reasons":{"injury":{"outcome":"keep_current","opponentScore":6,"fighter":"asks"},"voluntary":{"outcome":"fixed_loss","opponentScore":6,"fighter":"asks"},"conduct_violation":{"outcome":"fixed_loss","opponentScore":6,"fighter":"disqualified"}},"disqualifyAfter":2,"disqualifyBeforeFirstBout":false,"blackCardOpponentScore":6}'::jsonb -- literal: ffamhe_forfeit_rules
   WHERE built_in AND owner_organization_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION '0235: % built-in penalty rulesets took the FFAMHE forfeit rules, not 1', n;
  END IF;
END $$;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.penalty_rulesets
       WHERE built_in AND owner_organization_id IS NULL
         AND forfeit_rules->>'disqualifyAfter' = '2') <> 1 THEN
    RAISE EXCEPTION '0235: the built-in penalty ruleset does not disqualify after 2 forfeits';
  END IF;
END $$;

ALTER TABLE public.penalty_ruleset_versions
  ADD COLUMN forfeit_rules jsonb NOT NULL
    DEFAULT '{"reasons":{"injury":{"outcome":"keep_current","opponentScore":6,"fighter":"asks"},"voluntary":{"outcome":"fixed_loss","opponentScore":6,"fighter":"asks"},"conduct_violation":{"outcome":"fixed_loss","opponentScore":6,"fighter":"disqualified"}},"disqualifyAfter":"off","disqualifyBeforeFirstBout":false,"blackCardOpponentScore":6}'::jsonb -- literal: club_start_forfeit_rules
    CONSTRAINT penalty_ruleset_versions_forfeit_rules_object
      CHECK (jsonb_typeof(forfeit_rules) = 'object');

UPDATE public.penalty_ruleset_versions v
   SET forfeit_rules = p.forfeit_rules
  FROM public.penalty_rulesets p
 WHERE p.id = v.penalty_ruleset_id;

ALTER TABLE public.penalty_ruleset_versions ALTER COLUMN forfeit_rules DROP DEFAULT;

UPDATE public.tournaments
   SET ruleset_config = ruleset_config - 'forfeitPolicy' - 'tournamentPolicy'
 WHERE ruleset_config ?| array['forfeitPolicy', 'tournamentPolicy'];

UPDATE public.custom_rulesets
   SET tf_config = tf_config - 'forfeitPolicy' - 'tournamentPolicy'
 WHERE tf_config ?| array['forfeitPolicy', 'tournamentPolicy'];

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tournaments
              WHERE ruleset_config ?| array['forfeitPolicy', 'tournamentPolicy'])
     OR EXISTS (SELECT 1 FROM public.custom_rulesets
                 WHERE tf_config ?| array['forfeitPolicy', 'tournamentPolicy']) THEN
    RAISE EXCEPTION '0235: a scoring ruleset or a Tournament still holds a forfeit rule';
  END IF;
END $$;
