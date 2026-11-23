-- 0280: a Workshop may keep no waiting list (operator, 2026-11-23).
--
-- Today a booking of a full session is put on the session's waiting list. With the switch off, it
-- is refused: the session is full, and the page says "Full" instead of "Join waitlist". People
-- already on the list stay on it, and a freed seat still goes to the first of them. The organiser
-- and the Workshop's instructor both set it; the API is the only writer.
--
-- Not private: the public Workshop page reads it to word its button.

ALTER TABLE public.workshops
  ADD COLUMN IF NOT EXISTS waitlist_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.workshops.waitlist_enabled IS
  'When off, a booking of a full session is refused instead of put on the waiting list. People already on it stay.';
