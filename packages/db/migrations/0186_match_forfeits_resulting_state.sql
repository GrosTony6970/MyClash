-- 0186_match_forfeits_resulting_state.sql
-- Record the result a forfeit PRODUCED, so voiding it can tell whether that
-- result is still the one on the row.
--
-- `previous_match_state` (0032) captures what the forfeit replaced, and
-- `voidForfeit` writes it back. Nothing captures what the forfeit WROTE, so the
-- void has no way to notice that the match moved on in between — and it can.
-- `liveMatchIds`' own comment already names three paths that put a forfeited
-- bout back in play with its record still active: `POST /matches/:id/reset`,
-- `PATCH /matches/:id/status`, and the clock's `reopen`, which validates the
-- clock state machine and never reads `matches.status`.
--
-- The guard those paths have today is status-shaped and therefore porous. A bout
-- reset and then legitimately re-fought is `completed` again, so it is not
-- 'running' or 'paused', so `liveMatchIds` does not protect it, so voiding the
-- stale record restores the PRE-forfeit snapshot straight over a real, played
-- result. Silent data loss, and the played scores are gone.
--
-- A recorded post-state makes the question answerable without guessing: compare
-- the row to what this record left, and refuse when they differ. The comparison
-- is the same six columns `matchSnapshot` already captures, so the two halves
-- stay the same shape.
--
-- DEFAULT '{}' rather than NOT NULL-with-backfill: rows written before this
-- migration have no honest answer, and inventing one would make the new guard
-- refuse voids it has no evidence against. An empty object means "unknown",
-- and the service falls back to the old status check for those.

alter table public.match_forfeits
  add column if not exists resulting_match_state jsonb not null default '{}'::jsonb;

comment on column public.match_forfeits.resulting_match_state is
  'The match result this forfeit produced, in matchSnapshot shape (status, '
  'red_score, blue_score, winner_registration_id, ended_at, end_reason). Read '
  'by voidForfeit to refuse restoring over a result the match has since been '
  'replayed to. Empty object = recorded before 0186, guard falls back to status.';
