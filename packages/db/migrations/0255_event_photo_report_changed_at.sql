-- 0255: a Report's second time — when it last changed (rulings 457, 460, 466)
-- (docs/superpowers/specs/2026-11-03-event-photos-design.md, "Moderation" [rev 466]).
--
-- THE GAP. A phone reports a photo once (0252's key); a repeat with a comment replaces the comment
-- (0253, ruling 453) and kept the report's one time, `created_at`. Keep clears the reports up to the
-- newest time the moderator's screen showed (ruling 457). So a comment changed after the screen was
-- read still carried its first time, and Keep cleared it unseen.
--
-- THE FIX (ruling 466). `updated_at` is the report's last change: its first time on insert (both
-- defaults are the insert's one now()), moved to now() whenever the comment's words change. Keep's
-- bound, the queue's comment order and `lastReportAt` read it. `created_at` stays the first time
-- and stays the one column the phone's hourly report limit counts.
--
-- THE DATABASE STAMPS IT, never the API: Keep's bound comes back from the database verbatim, so
-- both sides of the comparison are one clock. now() is the edit's transaction start. A repeat with
-- the same words, or with no comment (the API's ON CONFLICT DO NOTHING, which runs no UPDATE),
-- changes nothing.
--
-- ONE OWNER. The trigger reuses 0181's generic `touch_updated_at()` (invoker, search_path pinned),
-- under a WHEN on the comment: the comment is the only column a report ever changes, so "updated"
-- and "comment changed" are the same moment.
--
-- NO BACKFILL. A report that exists now takes this migration's time, later than its first: a screen
-- loaded before the migration keeps it on Keep (the safe side), and such reports tie in the
-- comment order. No index: Keep filters on photo_id first, which leads the primary key.

ALTER TABLE public.event_photo_reports
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

COMMENT ON COLUMN public.event_photo_reports.updated_at IS
  'The report''s last change: its first time, or when its comment last changed. Keep''s bound.';

-- Idempotent: drop-then-create survives a replay re-run (0181).
DROP TRIGGER IF EXISTS event_photo_reports_touch_updated_at ON public.event_photo_reports;

CREATE TRIGGER event_photo_reports_touch_updated_at
  BEFORE UPDATE ON public.event_photo_reports
  FOR EACH ROW
  WHEN (NEW.comment IS DISTINCT FROM OLD.comment)
  EXECUTE FUNCTION public.touch_updated_at();

NOTIFY pgrst, 'reload schema';
