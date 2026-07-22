-- Migration 0151: per-version snapshots for penalty_rulesets (immutability).
--
-- Today a penalty_rulesets row is mutable in place: updateRuleset overwrites the
-- parent row AND delete+reinserts every penalty_ruleset_entries row under the
-- same id/version, with no guard against editing a ruleset a live tournament
-- already pins. This is the same hole 0052 closed for scoring (custom_rulesets):
-- once a tournament pins a definition, any later edit silently changes how future
-- cards escalate/cost. This table snapshots the published payload of each version
-- so:
--
--   1. A published/pinned version is captured immutably (the content-hash slice
--      fingerprints it; rollback restores it).
--   2. Rollback to a previous version is a copy-snapshot-onto-parent operation,
--      not a destructive overwrite.
--   3. `is_frozen` flips TRUE the moment a tournament pins the ruleset, after
--      which the in-service edit-guard refuses further edits.
--
-- KEY DIFFERENCE FROM SCORING: a penalty ruleset stores its definition NORMALISED
-- across the N-row child table penalty_ruleset_entries, not inline JSONB. A
-- snapshot therefore cannot be a single-row column copy — the entries are
-- serialised into one ordered JSONB array on the snapshot row. Snapshots are
-- read-only and never queried by individual entry, so one atomic array beats a
-- child snapshot table (single INSERT, no cross-row consistency gap on write).

CREATE TABLE IF NOT EXISTS public.penalty_ruleset_versions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  penalty_ruleset_id        UUID NOT NULL REFERENCES public.penalty_rulesets(id) ON DELETE CASCADE,
  version                   TEXT NOT NULL,
  name                      TEXT NOT NULL,
  description               TEXT,
  accumulation_scope        TEXT NOT NULL,
  -- Per-card point costs + black-card forfeit scopes (parent columns from 0054).
  yellow_card_points        INT NOT NULL,
  red_card_points           INT NOT NULL,
  black_card_points         INT NOT NULL,
  first_black_card_forfeit  TEXT NOT NULL,
  second_black_card_forfeit TEXT NOT NULL,
  -- The N penalty_ruleset_entries rows serialised as an ordered JSONB array of
  -- { groupNumber, refNumber, shortName, description, sanctions, sortOrder }.
  entries                   JSONB NOT NULL DEFAULT '[]'::jsonb,
  published_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_by_user_id      UUID,
  is_frozen                 BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (penalty_ruleset_id, version),
  -- Mirror the parent CHECKs (0016/0054) onto the snapshot so a rolled-back or
  -- pinned version can never restore an out-of-domain value.
  CONSTRAINT penalty_ruleset_versions_scope_check
    CHECK (accumulation_scope IN ('match', 'phase', 'tournament')),
  CONSTRAINT penalty_ruleset_versions_first_forfeit_check
    CHECK (first_black_card_forfeit IN ('match', 'tournament', 'none')),
  CONSTRAINT penalty_ruleset_versions_second_forfeit_check
    CHECK (second_black_card_forfeit IN ('match', 'tournament', 'none'))
);

-- History lookup (most recent first) + freeze/resolve by (ruleset, version).
CREATE INDEX IF NOT EXISTS idx_penalty_ruleset_versions_ruleset
  ON public.penalty_ruleset_versions (penalty_ruleset_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_penalty_ruleset_versions_version
  ON public.penalty_ruleset_versions (penalty_ruleset_id, version);

-- Deny-all: RLS enabled with NO policies. Reads/writes go through the NestJS API
-- (service_role, which bypasses RLS); anon/authenticated get nothing. This
-- mirrors custom_ruleset_versions (0052 + 0141) — a snapshot table has no
-- browser/PostgREST/anon reader, and RLS-on with no policy is the safe default
-- (never world-readable as anon).
ALTER TABLE public.penalty_ruleset_versions ENABLE ROW LEVEL SECURITY;
