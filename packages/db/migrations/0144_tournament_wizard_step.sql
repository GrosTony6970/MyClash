-- Migration 0144: record which creation-wizard step a tournament reached.
--
-- `computeWizardStep` infers progress from which JSONB blobs have been
-- written. That cannot work, because the server writes complete blobs:
--
--   * `ruleset_config` is SEEDED AT CREATE from the ruleset defaults, and
--     those defaults contain `matchFormat.pointCap` — so the Step-2 marker is
--     already satisfied the instant the row exists.
--   * `normalizeTournamentScoringConfig` backfills `buttons.clean`,
--     `buttons.afterblow` AND `display.sideColors` from DEFAULT_SCORING_CONFIG
--     on EVERY scoringConfig PATCH. Step 2 sends `{ afterblowMode }`, so the
--     Step-3 marker is satisfied by a step that is not Step 3.
--   * `Object.keys(ruleset_config).length > 0` is likewise true from create,
--     so the Step-4 branch is unreachable — already noted in
--     compute-wizard-step.test.ts.
--
-- Net effect today: once Step 2 saves, the function can only return null, so
-- "Resume setup" disappears from a tournament whose display and advanced
-- settings were never opened. Seeding scoring_config_json at creation (the
-- named-targets work) would extend that to Step 2 as well.
--
-- No other key can substitute. The plan suggested keying off
-- `scoring_config_json.display` instead, but the normalizer fills that in too,
-- so it carries exactly the same false positive. `lock_config_json` is the one
-- blob NOT written at create — which is why the Step-4 half of the heuristic
-- is the only half that ever worked. Progress has to be recorded, not guessed.
--
-- NULL means "predates this column": the reader falls back to the old
-- heuristic for those rows, so nothing changes for a draft already in flight.

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS wizard_step SMALLINT
    CHECK (wizard_step IS NULL OR wizard_step BETWEEN 1 AND 4);

COMMENT ON COLUMN tournaments.wizard_step IS
  'Highest creation-wizard step completed (1-4). NULL for rows created before tracking existed. Monotonic: saving an earlier step never lowers it.';
