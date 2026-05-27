-- 0066_rename_tournament_policy.sql
--
-- Move the wizard-shape `forfeitPolicy` blob (3 fields:
-- forfeitDrawsCount / forfeitFighterBefore1stMatch / disqualifyAfter)
-- to a new top-level `tournamentPolicy` key inside
-- `tournaments.ruleset_config`. This frees the `forfeitPolicy` name
-- so the rulesets-engine `forfeitPolicy.reasons.*` blob can live
-- there without colliding.
--
-- Why: the tournament-creation wizard's Step 4 PATCH was failing with
-- 400 because the persisted row carried the engine-shape
-- `forfeitPolicy.reasons.*` payload, then the wizard's spread-merge
-- pulled `reasons` into its state and PATCHed it back. The API DTO's
-- `forbidNonWhitelisted: true` validation rejected the `reasons` key.
-- The rename (this migration + the matching DTO/wizard change in the
-- same commit) ensures the two concepts never share a JSON key again.
--
-- Guard: a row's `forfeitPolicy` is only moved when it actually
-- contains one of the three wizard fields. Rows whose `forfeitPolicy`
-- has the engine `reasons` shape (or any other shape) are left
-- untouched — those continue to feed the rulesets engine via the
-- existing `forfeitPolicy` key.

BEGIN;

UPDATE tournaments
SET ruleset_config = jsonb_set(
    ruleset_config #- '{forfeitPolicy}',
    '{tournamentPolicy}',
    ruleset_config -> 'forfeitPolicy',
    true
  )
WHERE ruleset_config ? 'forfeitPolicy'
  AND (
    (ruleset_config -> 'forfeitPolicy') ? 'forfeitDrawsCount'
    OR (ruleset_config -> 'forfeitPolicy') ? 'forfeitFighterBefore1stMatch'
    OR (ruleset_config -> 'forfeitPolicy') ? 'disqualifyAfter'
  )
  AND NOT ((ruleset_config -> 'forfeitPolicy') ? 'reasons');

COMMIT;
