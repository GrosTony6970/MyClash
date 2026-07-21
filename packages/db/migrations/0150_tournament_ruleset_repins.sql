-- Mid-event ruleset re-pin audit.
--
-- Standings resolve a tournament's LIVE ruleset pointer at read time, so
-- changing the pointer after matches are scored re-ranks recorded results. That
-- is allowed only through an audited "re-pin" ceremony (typed confirmation +
-- mandatory justification, org-owner/super-admin, completed/archived blocked).
-- This append-only table is the ceremony's permanent record: actor, from->to
-- (code, version), the per-bucket diff, whether ranking stayed compatible, the
-- required justification, and the materialised before/after placings so the
-- change is transparent even after later match edits.
--
-- Reads/writes go through the API (service_role); the public event-page
-- disclosure rides on the /standings projection rather than a direct anon read,
-- so this table needs no anon policy — only an internal super-admin/org view.
CREATE TABLE IF NOT EXISTS public.tournament_ruleset_repins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  -- Nullable: a system/automated re-pin has no named actor (mirrors the
  -- audit_log convention of a null actor for background writers).
  actor_user_id UUID,
  from_code TEXT NOT NULL,
  from_version TEXT NOT NULL,
  to_code TEXT NOT NULL,
  to_version TEXT NOT NULL,
  -- DB-level enforcement of the ceremony: a re-pin cannot be recorded without a
  -- justification (matches exchange_edit_requests.reason).
  justification TEXT NOT NULL,
  -- { grammar, endConditions, ranking, rankingCompatible } from diffRulesetBuckets.
  bucket_diff JSONB NOT NULL DEFAULT '{}'::jsonb,
  ranking_compatible BOOLEAN NOT NULL,
  -- Materialised StandingsRow snapshots ({ rank, registrationId, displayName,
  -- stats }[]) taken immediately before and after the re-point, so a historical
  -- snapshot is not silently changed by later match edits.
  placings_before JSONB NOT NULL DEFAULT '[]'::jsonb,
  placings_after JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The public disclosure reads the latest re-pin per tournament.
CREATE INDEX IF NOT EXISTS tournament_ruleset_repins_tournament_created_idx
  ON public.tournament_ruleset_repins (tournament_id, created_at DESC);

CREATE INDEX IF NOT EXISTS tournament_ruleset_repins_event_created_idx
  ON public.tournament_ruleset_repins (event_id, created_at DESC);

ALTER TABLE public.tournament_ruleset_repins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins manage tournament ruleset repins" ON public.tournament_ruleset_repins;
CREATE POLICY "Super admins manage tournament ruleset repins"
  ON public.tournament_ruleset_repins
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Org members read tournament ruleset repins" ON public.tournament_ruleset_repins;
CREATE POLICY "Org members read tournament ruleset repins"
  ON public.tournament_ruleset_repins
  FOR SELECT
  TO authenticated
  USING (public.has_org_role(public.event_org_id(event_id), 'editor'));
