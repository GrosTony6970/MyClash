-- Migration 0147: TF_v1's mirror row records deductive afterblow.
--
-- 0143 backfilled the TF_v1 mirror row with afterblow_mode = 'full'. That was
-- the codebase's assumption at the time; FFAMHE actually nets the retaliation
-- against the attacker (deductive), and TF_v1's code metadata now says so
-- (packages/rulesets/src/tf_v1). Nothing reads the mirror column for TF_v1 —
-- the resolver and the seeder use the code metadata for is_system rows — but a
-- mirror that says 'full' while the engine seeds 'deductive' is a field that
-- lies, so correct it rather than leave the drift for a future reader.
--
-- Guarded on the current value so a replay (no ledger) and any operator edit
-- are both respected: only the stale 'full' left by 0143 is moved.

UPDATE custom_rulesets
SET afterblow_mode = 'deductive',
    updated_at = NOW()
WHERE code = 'TF_v1'
  AND is_system = TRUE
  AND afterblow_mode = 'full';
