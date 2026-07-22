-- Migration 0152: content-hash identity columns.
--
-- The content hash fingerprints a tournament's EFFECTIVE scoring behaviour (the
-- resolved ruleset definition + its pinned config + afterblowMode) paired with
-- its penalty definition — a content-derived identity, not just (code, version).
-- Two TF_v1 tournaments with different winBonus resolve to the same engine but
-- get different hashes. Computed in the API (canonical form in @myclash/rulesets,
-- sha256 via node:crypto) and stamped here.
--
--   tournaments.ruleset_content_hash — the tournament's CURRENT effective hash,
--     recomputed whenever its ruleset/config/penalty pin changes.
--   matches.ruleset_content_hash    — the hash IN FORCE when the match was
--     generated (copied from the tournament, like ruleset_code/version), frozen
--     thereafter so a scored match records exactly which behaviour produced it.
--
-- The penalty side of the pair had no version pointer — it was resolved live
-- from the parent penalty_rulesets row. These columns pin WHICH penalty version
-- is in force so the hash reads the immutable penalty_ruleset_versions snapshot:
--   tournaments.penalty_ruleset_version / events.penalty_ruleset_version.
--
-- All are nullable TEXT: existing rows backfill lazily (the operator wipes +
-- redeploys), and a null hash simply means "not yet stamped". No new tables, so
-- the columns inherit each table's existing RLS.

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS ruleset_content_hash TEXT,
  ADD COLUMN IF NOT EXISTS penalty_ruleset_version TEXT;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS penalty_ruleset_version TEXT;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS ruleset_content_hash TEXT;
