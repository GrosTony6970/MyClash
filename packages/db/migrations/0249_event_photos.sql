-- 0249: Event photos — the Event's photo mode and QR token version, the photo table, and the
-- counting function the upload checks before it reads a file
-- (docs/superpowers/specs/2026-11-03-event-photos-design.md, slice 2a).
--
-- The QR token itself is never stored: it is HMAC(PHOTO_TOKEN_SECRET, event_id:version), so the
-- public Event read (select '*') can carry the version without giving the token away. "New link"
-- bumps the version and every printed QR code of the old one stops working.
--
-- event_photos is deny-all: RLS on, no policy. The public never reads it directly; the API reads
-- and writes it as the service role (0247: a new table starts closed to web writes). Images live
-- in the private photo bucket, never in this database.

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS photo_mode TEXT NOT NULL DEFAULT 'off';
ALTER TABLE public.events
  ADD CONSTRAINT events_photo_mode_check CHECK (photo_mode IN ('off','live','approve')) NOT VALID;
ALTER TABLE public.events VALIDATE CONSTRAINT events_photo_mode_check;
COMMENT ON COLUMN public.events.photo_mode IS
  'Event photos: off (no upload, nothing shown), live (shown on arrival), approve (shown once a moderator approves). Default off.';

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS photo_token_version INTEGER NOT NULL DEFAULT 1 CHECK (photo_token_version > 0);
COMMENT ON COLUMN public.events.photo_token_version IS
  'Version of the Event''s photo QR token. The token is derived from it with a server secret and never stored; bumping it retires every printed QR code.';

CREATE TABLE IF NOT EXISTS public.event_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  tournament_id UUID REFERENCES public.tournaments(id) ON DELETE SET NULL,
  workshop_id UUID REFERENCES public.workshops(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('waiting','approved')),
  uploader_name TEXT CHECK (uploader_name IS NULL OR char_length(uploader_name) BETWEEN 1 AND 40),
  caption TEXT CHECK (caption IS NULL OR char_length(caption) BETWEEN 1 AND 200),
  device_id UUID NOT NULL,
  original_key TEXT NOT NULL UNIQUE,
  preview_key TEXT NOT NULL UNIQUE,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  crc32 BIGINT NOT NULL CHECK (crc32 BETWEEN 0 AND 4294967295),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (tournament_id IS NULL OR workshop_id IS NULL)
);

COMMENT ON TABLE public.event_photos IS
  'Photos sent to an Event from its QR link. Short-lived: deleted 30 days after the Event. Deny-all; the API writes as the service role.';
COMMENT ON COLUMN public.event_photos.device_id IS
  'The sending phone''s random id from its mc_photo_device cookie. Counts the per-device limit; names nobody.';
COMMENT ON COLUMN public.event_photos.crc32 IS
  'CRC-32 of the stored original, so the download zip can write its entry headers without reading each object twice.';

CREATE INDEX IF NOT EXISTS event_photos_event_idx ON public.event_photos (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS event_photos_device_idx ON public.event_photos (device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS event_photos_tournament_idx ON public.event_photos (tournament_id);
CREATE INDEX IF NOT EXISTS event_photos_workshop_idx ON public.event_photos (workshop_id);

ALTER TABLE public.event_photos ENABLE ROW LEVEL SECURITY;

-- What the upload checks before it reads a file: photos sent to the Event in the last hour, bytes
-- the Event stores, and photos this device sent to the Event in the last hour. A function because
-- PostgREST aggregates are off. Invoker rights: only the service role may run it, and it reads
-- the table as that role.
CREATE OR REPLACE FUNCTION public.event_photo_usage(p_event_id uuid, p_device_id uuid)
RETURNS TABLE (event_last_hour integer, event_bytes bigint, device_last_hour integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_catalog
AS $$
  SELECT
    (count(*) FILTER (WHERE created_at > now() - interval '1 hour'))::integer,
    coalesce(sum(byte_size), 0)::bigint,
    (count(*) FILTER (WHERE device_id = p_device_id AND created_at > now() - interval '1 hour'))::integer
  FROM public.event_photos
  WHERE event_id = p_event_id;
$$;

REVOKE EXECUTE ON FUNCTION public.event_photo_usage(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_photo_usage(uuid, uuid) TO service_role;
