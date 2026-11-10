-- 0258: a broadcast may go to the Workshop attendees or to the instructors of an Event (operator
-- rulings 533, 534).
--
-- "Workshop attendees": everyone with a seat or a waiting-list place in a session that still runs,
-- in any Workshop of the Event. "Instructors": everyone tagged as an instructor of the Event, and
-- everyone named on one of its Workshops. The API works out who they are; this list only names the
-- audience the broadcast was sent to.
--
-- No new table and no new column: the RLS policies of 0021 stand.

ALTER TABLE public.event_broadcast_notifications
  DROP CONSTRAINT IF EXISTS event_broadcast_target_type_check;

ALTER TABLE public.event_broadcast_notifications
  ADD CONSTRAINT event_broadcast_target_type_check CHECK (
    target_type IN (
      'all',
      'fighters',
      'referees',
      'fighters_and_referees',
      'specific_persons',
      'workshop_attendees',
      'instructors'
    )
  );

NOTIFY pgrst, 'reload schema';
