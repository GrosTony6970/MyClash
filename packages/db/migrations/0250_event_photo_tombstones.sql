-- 0250: Event photo tombstones — every path that removes a photo row queues its two image keys,
-- in the same transaction, for the worker to delete from the photo bucket; and the listing the
-- expiry job reads (docs/superpowers/specs/2026-11-03-event-photos-design.md,
-- "Storage and deletion"; slice 3).
--
-- WHY A TRIGGER. A photo row goes away on many paths: a moderator's delete, its Event's delete,
-- its club's delete (organizations -> events -> event_photos, both ON DELETE CASCADE), a
-- deletion-request approval (an Event delete), the expiry job. The cascades never reach API code,
-- so only the database sees every one. A row trigger fires for a row a cascade removes as for one
-- deleted by hand; a TRUNCATE fires no row trigger, so a statement trigger queues every key before
-- one (a hand TRUNCATE ... CASCADE from psql reaches this table too).
--
-- THE TOMBSTONE TABLE has no foreign key on purpose: it must outlive the Event and the photo it
-- names. It holds bucket keys only (events/<event>/<photo>/original.jpg): no name, no caption.
-- Deny-all: RLS on, no policy; the API reads and deletes it as the service role (0247: a new
-- table starts closed to web writes). The worker deletes the object first and the tombstone
-- second, so a tombstone never goes while its object may still exist.
--
-- RIGHTS. The trigger functions run with the deleting role's rights (SECURITY INVOKER, path
-- pinned): the API's service role, or a superuser by hand. A role that may not write the
-- tombstones may not delete a photo either: the delete fails with the insert. EXECUTE is checked
-- when a trigger is created, not when it fires, so revoking it from the web roles costs nothing.
--
-- event_photo_events(): the Events that still hold a photo, with the two columns the deletion
-- instant is read from (00:00 of end_date + 31 on the Event's clock; one owner in the API,
-- `photoDeletionInstant`). A function because PostgREST aggregates and DISTINCT are off.

CREATE TABLE IF NOT EXISTS public.event_photo_tombstones (
  object_key TEXT PRIMARY KEY,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.event_photo_tombstones IS
  'Photo bucket keys whose photo row is gone, waiting for the worker to delete the object. No foreign key: it outlives its Event. Deny-all; API only.';

CREATE INDEX IF NOT EXISTS event_photo_tombstones_queued_idx
  ON public.event_photo_tombstones (queued_at);

ALTER TABLE public.event_photo_tombstones ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.event_photo_tombstone_row()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO public.event_photo_tombstones (object_key)
  VALUES (OLD.original_key), (OLD.preview_key) ON CONFLICT DO NOTHING;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.event_photo_tombstone_all()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO public.event_photo_tombstones (object_key)
  SELECT original_key FROM public.event_photos
  UNION ALL
  SELECT preview_key FROM public.event_photos
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS event_photos_tombstone_row ON public.event_photos;
CREATE TRIGGER event_photos_tombstone_row
  AFTER DELETE ON public.event_photos
  FOR EACH ROW EXECUTE FUNCTION public.event_photo_tombstone_row();

DROP TRIGGER IF EXISTS event_photos_tombstone_truncate ON public.event_photos;
CREATE TRIGGER event_photos_tombstone_truncate
  BEFORE TRUNCATE ON public.event_photos
  FOR EACH STATEMENT EXECUTE FUNCTION public.event_photo_tombstone_all();

CREATE OR REPLACE FUNCTION public.event_photo_events()
RETURNS TABLE (event_id uuid, end_date date, timezone text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_catalog
AS $$
  SELECT e.id, e.end_date, e.timezone
  FROM public.events e
  WHERE EXISTS (SELECT 1 FROM public.event_photos p WHERE p.event_id = e.id);
$$;

REVOKE EXECUTE ON FUNCTION public.event_photo_tombstone_row() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.event_photo_tombstone_all() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.event_photo_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_photo_events() TO service_role;

NOTIFY pgrst, 'reload schema';
