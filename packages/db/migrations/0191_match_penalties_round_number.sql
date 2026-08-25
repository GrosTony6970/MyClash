-- 0191: a penalty belongs to the round it was given in.
--
-- THE DEFECT. `match_penalties` had no round column, so in a best-of match every
-- non-voided card in the whole bout was added to whichever round happened to be
-- open. In a BO3 a yellow taken in round 1 kept subtracting in rounds 2 and 3 —
-- and round 1 had already banked it in its `rounds_json` snapshot, so the same
-- card was counted twice and then a third time.
--
-- `recomputeBestOfRounds` filters EXCHANGES by round (that is what
-- exchanges.round_number is for, migration 0111) and did not filter penalties,
-- because there was nothing to filter on. This is that missing column.
--
-- WHAT CHANGES. One column, shaped exactly like the one 0111 added to
-- `exchanges`: NOT NULL DEFAULT 1. A single-round match — every match today —
-- keeps round 1 and behaves as it always did. The server stamps the value from
-- `matches.current_round` at write time, the way `createExchange` already does;
-- the pad sends no round, so a card queued offline cannot claim a round the
-- server has since moved past.
--
-- The index mirrors `exchanges_match_round_idx`. The existing
-- `match_penalties_match_idx` is (match_id, voided, sequence), which does not
-- cover a round predicate.

ALTER TABLE match_penalties
  ADD COLUMN IF NOT EXISTS round_number INTEGER NOT NULL DEFAULT 1;

-- Round-scoped score derivation filters by (match_id, round_number, voided).
CREATE INDEX IF NOT EXISTS match_penalties_match_round_idx
  ON match_penalties (match_id, round_number, voided);
