-- 0261: an Event may let people join it by themselves (operator rulings 516, 567, 568).
--
-- The organiser turns it on from the Event's Workshops page. With it on, a signed-in account that
-- is not on the Event's list may put itself on it from a Workshop page, and book. Off (the
-- default), only the organiser adds people, as before. Joining always needs an account: there is
-- no name-and-email walk-in (568).
--
-- A setting, as readable as photo_mode: the public Event read (select '*') carries it, and the
-- Workshop page reads it to offer "Join". No new table; the RLS policies of events stand, and the
-- API alone writes events (0247).

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS workshop_self_join BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN public.events.workshop_self_join IS
  'People with an account may put themselves on this Event''s list from a Workshop page. Default false: only the organiser adds people.';

NOTIFY pgrst, 'reload schema';
