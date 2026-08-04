-- ============================================================
-- MyClash — Legal acceptances (terms + privacy policy)
-- Migration: 0166_legal_acceptances.sql
-- Dep: 0001_init.sql (guest_sessions), 0002_rls.sql (is_super_admin)
--
-- Evidence that a person agreed to a specific, published version of
-- a document. The TEXT lives on the marketing site and the current
-- version lives in `packages/types/src/legal.ts` — this table stores
-- only who, which document, which version, and when.
--
-- APPEND-ONLY BY DESIGN. Re-accepting a revised policy inserts a new
-- row; nothing updates the old one. An acceptance that can be edited
-- after the fact is not evidence of anything, and the whole reason
-- this table exists is to be able to answer "what exactly did this
-- user agree to, and when" years later.
--
-- Two subjects, one table:
--   * user_id          — an account (organiser or fighter). The gate:
--                        signup is refused without it.
--   * guest_session_id — a participant who only looked up their own
--                        schedule. Notice, not a gate: they hand over
--                        no new personal data (the roster is already
--                        the organiser's), so blocking them behind a
--                        checkbox buys nothing. The row records that
--                        the notice was shown.
-- Exactly one of the two is set, enforced below.
-- ============================================================

CREATE TABLE IF NOT EXISTS legal_acceptances (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_session_id UUID REFERENCES guest_sessions(id) ON DELETE CASCADE,
  -- 'terms' | 'privacy' — mirrors LEGAL_DOCUMENT_KINDS. Kept as a
  -- CHECK rather than an enum so adding a third document is a one-line
  -- migration instead of an ALTER TYPE with a transaction caveat.
  document_kind    TEXT NOT NULL,
  -- The published "Last updated" date of the accepted document, e.g.
  -- '2026-05-13'. Free text, not a date: it is an opaque identifier of
  -- a published artefact, and the day it stops being a date we do not
  -- want a migration.
  version          TEXT NOT NULL,
  accepted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Where the acceptance came from. Kept because "prove they agreed"
  -- is the entire purpose; scrubbed by the erasure path with the rest
  -- of the subject's data.
  ip               TEXT,
  user_agent       TEXT,
  CONSTRAINT legal_acceptances_kind_ck
    CHECK (document_kind IN ('terms', 'privacy')),
  CONSTRAINT legal_acceptances_subject_ck
    CHECK (num_nonnulls(user_id, guest_session_id) = 1)
);

-- The hot read: "which documents is this user behind on?" — one lookup
-- per authenticated GET /api/v1/me, latest row per kind.
CREATE INDEX IF NOT EXISTS idx_legal_acceptances_user
  ON legal_acceptances (user_id, document_kind, accepted_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_guest_session
  ON legal_acceptances (guest_session_id)
  WHERE guest_session_id IS NOT NULL;

-- ── RLS (the ONLY boundary — PostgREST exposes `public` as anon) ────────────
ALTER TABLE legal_acceptances ENABLE ROW LEVEL SECURITY;

-- Read your own; write through the service key only. There is deliberately no
-- INSERT policy: an acceptance the client could write itself would be worth
-- nothing as evidence, and the server is the only party that can check the
-- posted version against the published one.
CREATE POLICY "legal_acceptances_owner_select" ON legal_acceptances
  FOR SELECT
  USING (is_super_admin() OR user_id = auth.uid());

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- End of 0166_legal_acceptances.sql
-- ============================================================
