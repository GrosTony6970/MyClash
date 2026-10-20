-- 0236: a Tournament may change the forfeit rules of its penalty ruleset (operator rulings 65 and
-- 73, 2026-10-20).
--
-- WHAT CHANGES. `tournaments.forfeit_rules` holds ONLY the organiser's changes: the keys changed,
-- at any depth (a reason's outcome, its opponent's score, what happens to the Fighter; "disqualify
-- after"; "a forfeit before the 1st bout disqualifies"; a black card forfeit's 0-X), plus
-- `firstBlackCard` / `secondBlackCard`. NULL: the Tournament changes nothing, and plays its penalty
-- ruleset's rules as they are. The API writes it (`applyForfeitPatch`), checks every value
-- (`ForfeitRulesPatchSchema`) and refuses a real change once a bout has started (ruling 73); the
-- column holds an object or NULL.
--
-- WHO WRITES IT. Only the API, as the service role: 0233 closed direct writes to `tournaments`.
-- WHO READS IT. Whoever reads the Tournament row (`tournaments_select`, 0203), as for its
-- `ruleset_config`: the rules a Tournament plays under are not a secret.

ALTER TABLE public.tournaments
  ADD COLUMN forfeit_rules jsonb
    CONSTRAINT tournaments_forfeit_rules_object
      CHECK (forfeit_rules IS NULL OR jsonb_typeof(forfeit_rules) = 'object');
