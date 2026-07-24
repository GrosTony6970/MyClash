-- Migration 0155: season-finalize marker for leagues.
--
-- Adds a nullable `finalized_at` timestamp so a league season can be frozen:
-- once stamped, the standings stop drifting as late linked events tick over
-- (LeaguesService.recomputeForEvent skips finalized leagues, and
-- recomputeLeagueRankings / the manual-recompute endpoint refuse to run on
-- one). This is a soft marker, NOT a status change — mirroring the 0153
-- `archived_at` pattern — so a finalized league stays `published` +
-- `public_visibility = true` and remains publicly visible with its frozen
-- table and derived season champions. Clearing the column (reopen) lets a
-- season resume recomputing.
--
-- No RLS change: leagues already has RLS enabled (migration 0015); this only
-- adds a nullable timestamp column, readable under the existing policies.

ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ NULL;
