-- ============================================================
-- MyClash — Directory groups (personal collections of global persons)
-- Migration: 0114_directory_groups.sql
-- Dep: 0023_global_persons.sql, 0002_rls.sql (is_super_admin), 0003_lookup_functions.sql
--
-- A "directory group" is a logged-in user's personal, private collection of
-- global_persons (fighters). Organizer/bookmark only — NO notifications (those
-- stay with the event-scoped `follows` table). Ownership is claimed-user only.
-- ============================================================

-- ── 1. Groups ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS directory_groups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 80),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Case-insensitive uniqueness of group name per owner.
CREATE UNIQUE INDEX IF NOT EXISTS directory_groups_owner_name_lower_uq
  ON directory_groups (owner_user_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_directory_groups_owner
  ON directory_groups (owner_user_id, sort_order);

-- ── 2. Members ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS directory_group_members (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         UUID NOT NULL REFERENCES directory_groups(id) ON DELETE CASCADE,
  global_person_id UUID NOT NULL REFERENCES global_persons(id) ON DELETE CASCADE,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT directory_group_members_group_person_uq UNIQUE (group_id, global_person_id)
);

CREATE INDEX IF NOT EXISTS idx_directory_group_members_group
  ON directory_group_members (group_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_directory_group_members_person
  ON directory_group_members (global_person_id);

-- ── 3. RLS (defense-in-depth; the API uses the service key and enforces
--          ownership in-service) ──────────────────────────────────────────────
ALTER TABLE directory_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE directory_group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "directory_groups_owner_all" ON directory_groups
  FOR ALL
  USING (is_super_admin() OR owner_user_id = auth.uid())
  WITH CHECK (is_super_admin() OR owner_user_id = auth.uid());

CREATE POLICY "directory_group_members_owner_all" ON directory_group_members
  FOR ALL
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM directory_groups g
      WHERE g.id = directory_group_members.group_id
        AND g.owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM directory_groups g
      WHERE g.id = directory_group_members.group_id
        AND g.owner_user_id = auth.uid()
    )
  );

-- ── 4. Compact per-fighter career stats for member cards ──────────────────────
-- Returns matches / wins / losses / events_attended for a set of global_person
-- ids in ONE round-trip. The win rule MUST match the public career profile
-- (fighter-career.ts buildFighterCareer).
-- SUPERSEDED by 0138, which drops the TOURNAMENT-status gate below (nothing ever
-- set tournaments.status='completed', so it zeroed every stat). Rules as of 0114:
--   • only matches with status='completed' in registrations whose TOURNAMENT
--     status='completed' count toward matches/wins/losses
--   • win  = matches.winner_registration_id = the fighter's registration
--   • loss = winner set AND not the fighter's registration (null winner = draw)
--   • events_attended = distinct events with status='completed'
--   • test-event results never count (events.is_test_event)
-- Registration→fighter identity flows through person_id → persons.global_person_id
-- (registrations carries no global person id; legacy fighter_id dropped in 0083).
CREATE OR REPLACE FUNCTION compact_fighter_stats(p_ids UUID[])
RETURNS TABLE (
  global_person_id UUID,
  matches          INT,
  wins             INT,
  losses           INT,
  events_attended  INT
)
LANGUAGE sql STABLE
AS $$
  WITH regs AS (
    SELECT
      r.id                AS reg_id,
      pe.global_person_id AS gp,
      t.status            AS t_status,
      e.id                AS event_id,
      e.status            AS e_status
    FROM registrations r
    JOIN persons pe    ON pe.id = r.person_id
    JOIN tournaments t ON t.id = r.tournament_id
    JOIN events e      ON e.id = t.event_id
    WHERE pe.global_person_id = ANY(p_ids)
      AND COALESCE(e.is_test_event, FALSE) = FALSE
  ),
  match_rows AS (
    SELECT
      rg.gp,
      (m.winner_registration_id = rg.reg_id) AS won,
      (m.winner_registration_id IS NOT NULL AND m.winner_registration_id <> rg.reg_id) AS lost
    FROM regs rg
    JOIN matches m
      ON (m.red_registration_id = rg.reg_id OR m.blue_registration_id = rg.reg_id)
    WHERE rg.t_status = 'completed'
      AND m.status = 'completed'
  )
  SELECT
    g.gp AS global_person_id,
    COALESCE(mm.matches, 0)::INT  AS matches,
    COALESCE(mm.wins, 0)::INT     AS wins,
    COALESCE(mm.losses, 0)::INT   AS losses,
    COALESCE(ev.events_attended, 0)::INT AS events_attended
  FROM (SELECT DISTINCT gp FROM regs) g
  LEFT JOIN (
    SELECT gp,
      COUNT(*)                    AS matches,
      COUNT(*) FILTER (WHERE won)  AS wins,
      COUNT(*) FILTER (WHERE lost) AS losses
    FROM match_rows
    GROUP BY gp
  ) mm ON mm.gp = g.gp
  LEFT JOIN (
    SELECT gp, COUNT(DISTINCT event_id) AS events_attended
    FROM regs
    WHERE e_status = 'completed'
    GROUP BY gp
  ) ev ON ev.gp = g.gp;
$$;

-- ── 5. Fuzzy global-person lookup (typo-tolerant search) ──────────────────────
-- Sibling of lookup_persons (0003). Returns up to p_limit ids ranked by trigram
-- similarity; the API hydrates full rows in this order. Excludes soft-deleted
-- and merged identities. Relies on the unaccent + pg_trgm extensions and the
-- global_persons_name_trgm_idx GIN index (0025).
CREATE OR REPLACE FUNCTION lookup_global_persons(
  p_query     TEXT,
  p_limit     INT DEFAULT 20,
  p_threshold FLOAT DEFAULT 0.2
)
RETURNS TABLE (
  id         UUID,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    gp.id,
    GREATEST(
      similarity(public.immutable_unaccent(gp.given_name || ' ' || gp.family_name), public.immutable_unaccent(p_query)),
      similarity(public.immutable_unaccent(gp.family_name || ' ' || gp.given_name), public.immutable_unaccent(p_query)),
      similarity(public.immutable_unaccent(gp.display_name), public.immutable_unaccent(p_query))
    ) AS similarity
  FROM global_persons gp
  WHERE gp.deleted_at IS NULL
    AND gp.merged_into_id IS NULL
    AND GREATEST(
      similarity(public.immutable_unaccent(gp.given_name || ' ' || gp.family_name), public.immutable_unaccent(p_query)),
      similarity(public.immutable_unaccent(gp.family_name || ' ' || gp.given_name), public.immutable_unaccent(p_query)),
      similarity(public.immutable_unaccent(gp.display_name), public.immutable_unaccent(p_query))
    ) >= p_threshold
  ORDER BY similarity DESC, gp.family_name ASC
  LIMIT p_limit;
$$;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- End of 0114_directory_groups.sql
-- ============================================================
