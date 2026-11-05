-- 0252: Event photo reports — a spectator's Report on a public photo
-- (docs/superpowers/specs/2026-11-03-event-photos-design.md, "The public"; slice 4a).
--
-- ONE ROW PER PHOTO AND PHONE. The phone is the anonymous device id the upload uses (the
-- `mc_photo_device` cookie): the primary key makes a second Report from the same phone a no-op
-- (the API inserts ON CONFLICT DO NOTHING). A report hides nothing: the photo stays visible until
-- a moderator deletes it. Keep deletes the photo's rows, so a later report counts again
-- (ruling 448).
--
-- NO event_id. A report belongs to its photo and goes with it (ON DELETE CASCADE): a moderator's
-- delete, the Event's, the club's, the expiry job's. The archive and the subject export never
-- carry it. db:review asks an index of its own for photo_id; the primary key leads with it, which
-- serves the cascade, so none is added.
--
-- TRUNCATE. With this key pointing at event_photos, a plain TRUNCATE event_photos is refused, even
-- with no report: use TRUNCATE ... CASCADE (which 0250's statement trigger still sees).
--
-- Deny-all: RLS on, no policy; the API reads and writes it as the service role (0247: a new table
-- starts closed to web writes).

CREATE TABLE IF NOT EXISTS public.event_photo_reports (
  photo_id UUID NOT NULL REFERENCES public.event_photos(id) ON DELETE CASCADE,
  device_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (photo_id, device_id)
);

COMMENT ON TABLE public.event_photo_reports IS
  'One Report per public photo and anonymous phone. Goes with its photo. Deny-all; API only.';

-- A phone's reports of the last hour: the API's per-phone limit.
CREATE INDEX IF NOT EXISTS event_photo_reports_device_idx
  ON public.event_photo_reports (device_id, created_at DESC);

ALTER TABLE public.event_photo_reports ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
