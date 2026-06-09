-- 0095_exchange_penalty_clock_time.sql
--
-- Capture the match-clock position (accumulated active ms) at the
-- moment each exchange / penalty is recorded, so the scoring pad's
-- timeline can show match-clock time (e.g. 01:30 into the bout)
-- instead of the wall-clock time of day.
--
-- The scoring frontend already computes and sends this value
-- (useScoringSubmit sends `clockTimeMs`; the penalty POST gains the
-- same field) — but the column never existed, and the API's
-- whitelist validation (forbidNonWhitelisted) rejected the unknown
-- field with a 400, silently blocking ALL scoring. Adding the column
-- + DTO field unblocks scoring AND backs the timeline display.
--
-- Nullable: pre-existing rows and any client that omits the field
-- stay valid; those rows render with an empty time cell.

BEGIN;

ALTER TABLE exchanges       ADD COLUMN IF NOT EXISTS clock_time_ms INTEGER;
ALTER TABLE match_penalties ADD COLUMN IF NOT EXISTS clock_time_ms INTEGER;

NOTIFY pgrst, 'reload schema';

COMMIT;
