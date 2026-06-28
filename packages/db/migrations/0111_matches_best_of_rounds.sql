-- 0111: Best-of-N multi-round matches (BO3/BO5/BO7) + round counter.
--
-- A match stays ONE row per pairing (pool standings & bracket slots remain 1:1
-- with matches). Multi-round matches live WITHIN that row:
--
--   exchanges.round_number  — tags each exchange to its round (open round only
--                             is scored live; default 1 = today's single round).
--   matches.current_round   — the round currently open for scoring.
--   matches.rounds_json      — closed-round snapshots [{round, redScore, blueScore,
--                             winnerColor|null, endReason}] (a time-ended round's
--                             outcome is not re-derivable from exchanges, so the
--                             closure is recorded here; corrections require reopen).
--   matches.red/blue_round_wins — denormalised round-win tally from rounds_json.
--   matches.awaiting_round_advance — a round auto-ended but the series isn't
--                             clinched; the scoreboard shows the "Start round N"
--                             overlay and scoring is gated until the operator advances.
--
-- bestOf itself is per-phase config in tournaments.ruleset_config.matchFormat
-- (JSONB) — no tournament columns. Round closure is also logged as a
-- `round_advance` match_event for audit (match_events.type has no CHECK).
--
-- bestOf = 1 (the default everywhere) keeps round_number = 1, rounds_json NULL,
-- and never sets awaiting_round_advance — i.e. existing single-round behaviour.

ALTER TABLE exchanges
  ADD COLUMN IF NOT EXISTS round_number INTEGER NOT NULL DEFAULT 1;

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS current_round          INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS red_round_wins         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blue_round_wins        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rounds_json            JSONB,
  ADD COLUMN IF NOT EXISTS awaiting_round_advance BOOLEAN NOT NULL DEFAULT FALSE;

-- Open-round score derivation filters by (match_id, round_number, voided).
CREATE INDEX IF NOT EXISTS exchanges_match_round_idx
  ON exchanges (match_id, round_number, voided);
