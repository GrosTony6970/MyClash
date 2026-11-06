-- 0254: Event photos sent from a personal space (design Goal 11, slice 6a).
--
-- A signed-in person may send a photo to one of their own Events without the QR code. The photo
-- names the account that sent it, so its owner can list and delete it, and its limit counts per
-- account instead of per phone. A photo comes from a phone (the QR page, `device_id`) or from an
-- account (`uploader_user_id`), never both.
--
-- The account link has no ON DELETE action, so deleting an account that still holds a photo is
-- refused. Erasure deletes these rows first (`ErasureService.deleteOwnedRows`, before the account
-- goes). A cascade from the auth server's own delete would fire the tombstone trigger (0250) as
-- the auth server's role, which may not write the deny-all tombstones.
--
-- The table stays deny-all (0249): no policy; the API reads and writes as the service role.

ALTER TABLE public.event_photos ADD COLUMN IF NOT EXISTS uploader_user_id uuid REFERENCES auth.users(id);
COMMENT ON COLUMN public.event_photos.uploader_user_id IS
  'The account that sent it from its personal space (design Goal 11); null for a QR photo. An auth uid, never a person id. No cascade: erasure deletes these rows before the account goes.';

ALTER TABLE public.event_photos ALTER COLUMN device_id DROP NOT NULL;
COMMENT ON COLUMN public.event_photos.device_id IS
  'The sending phone''s random id from its mc_photo_device cookie; null for a photo an account sent. Counts the per-device limit; names nobody.';

ALTER TABLE public.event_photos
  ADD CONSTRAINT event_photos_one_sender CHECK (num_nonnulls(device_id, uploader_user_id) = 1) NOT VALID;
ALTER TABLE public.event_photos VALIDATE CONSTRAINT event_photos_one_sender;

-- A name typed on the QR page keeps its 40 characters; an account's profile name may run to 200
-- (the profile's own limit). No IF EXISTS: a wrong name must fail the replay.
ALTER TABLE public.event_photos DROP CONSTRAINT event_photos_uploader_name_check;
ALTER TABLE public.event_photos
  ADD CONSTRAINT event_photos_uploader_name_len CHECK (
    uploader_name IS NULL
    OR char_length(uploader_name) BETWEEN 1 AND CASE WHEN uploader_user_id IS NULL THEN 40 ELSE 200 END
  );

CREATE INDEX IF NOT EXISTS event_photos_uploader_idx
  ON public.event_photos (uploader_user_id, event_id, created_at DESC)
  WHERE uploader_user_id IS NOT NULL;

-- The sender's last hour now counts by phone or by account. Its other caller (the organiser's
-- summary) passes two arguments, so the third defaults to null.
DROP FUNCTION public.event_photo_usage(uuid, uuid);
CREATE FUNCTION public.event_photo_usage(p_event_id uuid, p_device_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS TABLE (event_last_hour integer, event_bytes bigint, sender_last_hour integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_catalog
AS $$
  SELECT
    (count(*) FILTER (WHERE created_at > now() - interval '1 hour'))::integer,
    coalesce(sum(byte_size), 0)::bigint,
    (count(*) FILTER (
      WHERE (device_id = p_device_id OR uploader_user_id = p_user_id)
        AND created_at > now() - interval '1 hour'
    ))::integer
  FROM public.event_photos
  WHERE event_id = p_event_id;
$$;

REVOKE EXECUTE ON FUNCTION public.event_photo_usage(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_photo_usage(uuid, uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
