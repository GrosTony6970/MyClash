-- 0253: a Report's comment — why a spectator reports a photo ("this is me, please remove it")
-- (docs/superpowers/specs/2026-11-03-event-photos-design.md, "The public" [rev 452-453]; slice 4b).
--
-- OPTIONAL, 200 CHARACTERS AT MOST (ruling 452, as a caption). NULL is "no comment"; an empty
-- string is never stored (the API sends NULL for it), so the CHECK refuses it.
--
-- ONE COMMENT PER PHOTO AND PHONE. A second Report by the same phone with a comment replaces the
-- first (ruling 453: ON CONFLICT DO UPDATE SET comment); one with no comment leaves it (DO NOTHING).
-- It is still one report: created_at is not touched.
--
-- WHO READS IT. Free text from an anonymous phone, for the moderators only: the table stays
-- deny-all (0252: RLS on, no policy; the API reads and writes it as the service role). It goes
-- with its row: Keep deletes the photo's reports, and every photo deletion cascades (0252), so no
-- comment outlives the photo's deletion instant.

ALTER TABLE public.event_photo_reports
  ADD COLUMN IF NOT EXISTS comment TEXT NULL
  CONSTRAINT event_photo_reports_comment_length
  CHECK (comment IS NULL OR char_length(comment) BETWEEN 1 AND 200);

COMMENT ON COLUMN public.event_photo_reports.comment IS
  'Why the phone reported the photo (optional, 1-200 characters). Moderators only.';

NOTIFY pgrst, 'reload schema';
