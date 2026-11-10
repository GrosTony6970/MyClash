-- 0259: who was in the room, per Workshop session (operator rulings 539-546).
--
-- A booking carries a check-in: the instructor or a Workshop lead ticks the people in front of
-- them. A Workshop may also let the Event's front desk tick its people on the day they arrive
-- (`auto_check_in`). The tick is information only: it never changes a booking, and a seat is
-- enough to rate (539).
--
-- `check_in_source` says who last set the tick:
--   NULL   nobody: no tick.
--   'desk' the front desk, at an arrival, for a Workshop whose switch is on. Always with a time.
--   'hand' somebody tapped it. With a time = ticked; without = cleared by hand. Once a booking is
--          'hand', the desk never touches it again (545).
-- The API is the only writer (`workshops/workshop-check-in.ts`); the table takes no web write
-- since 0247.
--
-- Who was in the room is personal data, like the desk's arrivals (0174), which nobody reads
-- through PostgREST since 0247. The read policy of 0002 lets any member of the organising club read
-- a booking, and a policy hides rows, never one field. So the table's SELECT grant is split per
-- column for both public roles (as 0205 did for referee_assignments), and the two new columns are
-- left out (ruling 548). The API reads them with the service role; the roster screens show them.
--
-- TRAP FOR THE NEXT MIGRATION: a column added to workshop_enrollments later is readable by neither
-- public role until a GRANT names it. `pnpm db:rls-probe` (PRIVATE_COLUMNS) and
-- packages/db/test/workshop-check-in-private.test.ts pin both statements.

ALTER TABLE public.workshops
  ADD COLUMN IF NOT EXISTS auto_check_in BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.workshop_enrollments
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;

ALTER TABLE public.workshop_enrollments
  ADD COLUMN IF NOT EXISTS check_in_source TEXT;

ALTER TABLE public.workshop_enrollments
  DROP CONSTRAINT IF EXISTS workshop_enrollments_check_in_source_check;

ALTER TABLE public.workshop_enrollments
  -- A CASE, not an OR of comparisons: `NULL = 'desk'` is NULL, and a CHECK that reads NULL
  -- passes, so the OR form let a time with no source in.
  ADD CONSTRAINT workshop_enrollments_check_in_source_check CHECK (
    CASE
      WHEN check_in_source IS NULL THEN checked_in_at IS NULL
      WHEN check_in_source = 'desk' THEN checked_in_at IS NOT NULL
      WHEN check_in_source = 'hand' THEN true
      ELSE false
    END
  );

-- The desk reads one person's bookings at each arrival. Nothing indexed `user_id` alone.
CREATE INDEX IF NOT EXISTS workshop_enrollments_user_idx
  ON public.workshop_enrollments(user_id);

REVOKE SELECT ON public.workshop_enrollments FROM anon, authenticated;
GRANT SELECT (id, workshop_session_id, user_id, status, position, enrolled_at, updated_at,
  global_person_id) ON public.workshop_enrollments TO anon, authenticated;

COMMENT ON COLUMN public.workshops.auto_check_in IS
  'When on, the front desk ticks this Workshop''s people in the sessions of the day they arrive (ruling 540, 543, 544).';
COMMENT ON COLUMN public.workshop_enrollments.checked_in_at IS
  'When the person was ticked present in this session. Information only: never changes the booking.';
COMMENT ON COLUMN public.workshop_enrollments.check_in_source IS
  'desk | hand | NULL. hand without a time = cleared by hand; the desk never overwrites hand (545).';

NOTIFY pgrst, 'reload schema';
