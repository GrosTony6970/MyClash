-- 0276: a protest is its own entry of the Match (the protest counter's design,
-- docs/superpowers/specs/2026-11-16-protest-counter-design.md).
--
-- A protest ("réclamation") is one tap on the scoring pad when a Fighter disputes the referee's
-- call. It is recorded on the Match beside its Exchanges and cards, and it never reaches the
-- score: no ruleset reads it and the score recompute never runs for it.
--
-- WHAT CHANGES.
--   1. `match_protests`, shaped after `match_penalties` (0016, 0018, 0095, 0191) without the card
--      columns. `sequence` comes from the pad's one counter that Exchanges and cards already share,
--      so it orders the Match's history; it is unique within the protests of a Match only, as a
--      card's is within the cards. `client_uuid` is the pad's id of the tap: a resend finds the
--      saved row. `by_user_id` keeps no key, as on `match_penalties`: it names an account or, for a
--      PIN session, nobody. `round_number` is the Match's round when the protest arrived.
--   2. Read rule: the readers of `match_penalties` (0200's anonymous branch). Its club-member
--      branch is left out: since 0273 a signed-in reader reads through the API only, so that
--      branch can open for no one (0274's rule), and the rule calls no helper (0275: none to grant).
--   3. No write rule and no write grant: only the API writes it, as 0238 ruled for the other Match
--      tables (0247: a new table starts closed to web writes).
--   4. Live updates, as 0167 did for cards: the old row on each change, and the publication.
--
-- WHAT DOES NOT CHANGE. No existing table, rule or function. A Match, a Tournament, a Registration
-- delete takes its protests by cascade, as it takes its cards; a staff account delete leaves them,
-- with no account named.
--
-- ── Security posture ────────────────────────────────────────────────────────
--
-- One new table, RLS on, one read rule for anon on public bouts, no write for any web role. No new
-- function, no new grant.

CREATE TABLE IF NOT EXISTS match_protests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_uuid UUID NOT NULL UNIQUE,
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  round_number INTEGER NOT NULL DEFAULT 1,
  clock_time_ms INTEGER,
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  by_user_id UUID,
  staff_account_id UUID REFERENCES event_staff_accounts(id) ON DELETE SET NULL,
  voided BOOLEAN NOT NULL DEFAULT FALSE,
  voided_reason TEXT,
  UNIQUE (match_id, sequence)
);

CREATE INDEX IF NOT EXISTS match_protests_match_idx
  ON match_protests (match_id, voided, sequence);
CREATE INDEX IF NOT EXISTS match_protests_tournament_idx
  ON match_protests (tournament_id, voided);
CREATE INDEX IF NOT EXISTS match_protests_registration_idx
  ON match_protests (registration_id, voided);
CREATE INDEX IF NOT EXISTS match_protests_staff_account_idx
  ON match_protests (staff_account_id);

ALTER TABLE match_protests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "match_protests_select" ON match_protests;
CREATE POLICY "match_protests_select" ON match_protests FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM matches m
      JOIN phases p ON p.id = m.phase_id
      JOIN tournaments t ON t.id = p.tournament_id
      JOIN events e ON e.id = t.event_id
      WHERE m.id = match_id
        AND e.status IN ('published','running','completed')
        AND t.status IN ('published','running','completed')
    )
  );

ALTER TABLE match_protests REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'match_protests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE match_protests;
  END IF;
END
$$;
