/**
 * The bar the Workshops module manages a workshop at, and the Event-role check
 * for a route addressed by workshop enrolment.
 *
 * An enrolment carries no Event of its own — the chain is enrolment → session →
 * workshop → Event. It is read from the ROW, never taken from the caller, so
 * naming an enrolment cannot move the decision onto an Event the caller holds.
 *
 * Why a second walk. `WorkshopsService.authorizeSession` already walks session
 * → workshop → Event and is a public hook for exactly this; only the first hop
 * here is new. Reusing it would make `FightersModule` import `WorkshopsModule`,
 * which drags BullMQ and the workers graph into the fighters graph for one
 * rarely-hit route. That is the trade being made, and it has a cost: the
 * workshops copy has already grown an instructor branch this one does not have
 * (see the roster note below), so the two can drift. Revisit if a third caller
 * appears. It sits beside `event-authz.ts` rather than inside it because that
 * file is at its line budget.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { assertCanManageEvent, type EventAuthzDeps, type OrgRole } from './event-authz';

/**
 * Managing a workshop — its sessions, instructors and roster — needs
 * `workshop_lead` on its Event, one step below `editor`. Linking an enrolment
 * to a global profile is a roster edit, so it takes the same bar (operator
 * ruling 38, 2026-09-22).
 *
 * Its roster siblings do not all agree, so be exact: enrolling a person and
 * promoting off the waitlist take this bar, through `assertCanManageSession`.
 * Accepting and refusing an enrollee go through
 * `assertCanManageSessionAsInstructorOrLead`, which ALSO admits an instructor
 * of that workshop holding no org role — so this route is stricter than two of
 * the four. RLS `workshop_enrollments_write` says `editor`; the module has been
 * the looser of the two since it shipped, and the ruling kept the module's own
 * bar rather than RLS's.
 */
export const WORKSHOP_MANAGE_ROLE: OrgRole = 'workshop_lead';

/** Assert the caller may manage the workshop an enrolment is in, on its own Event. */
export async function assertCanManageWorkshopEnrollment(
  deps: EventAuthzDeps,
  enrollmentId: string,
  userId: string,
): Promise<void> {
  // One message for every broken hop: which of the three rows is missing says
  // nothing a caller is entitled to know, and telling them apart would make the
  // route an existence oracle over three tables instead of one.
  //
  // Hops 2 and 3 look unreachable — all three foreign keys are NOT NULL and
  // ON DELETE CASCADE (0001_init.sql), so a live enrolment implies a live
  // session and workshop. They fire on a RACE: these are three round-trips, not
  // one snapshot, so an organiser deleting the session (workshops.service.ts
  // `deleteSession`) between hop 1 and hop 2 leaves this holding a row whose
  // parent has gone. Refusing is right there — the enrolment is being cascaded
  // away as we read.
  const missing = `Workshop enrolment ${enrollmentId} not found`;

  const { data: enrollment, error } = await deps.supabase.service
    .from('workshop_enrollments')
    .select('workshop_session_id')
    .eq('id', enrollmentId)
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  if (!enrollment) throw new NotFoundException(missing);

  const { data: session, error: sessionError } = await deps.supabase.service
    .from('workshop_sessions')
    .select('workshop_id')
    .eq('id', (enrollment as { workshop_session_id: string }).workshop_session_id)
    .maybeSingle();
  if (sessionError) throw new BadRequestException(sessionError.message);
  if (!session) throw new NotFoundException(missing);

  const { data: workshop, error: workshopError } = await deps.supabase.service
    .from('workshops')
    .select('event_id')
    .eq('id', (session as { workshop_id: string }).workshop_id)
    .maybeSingle();
  if (workshopError) throw new BadRequestException(workshopError.message);
  if (!workshop) throw new NotFoundException(missing);

  await assertCanManageEvent(
    deps,
    (workshop as { event_id: string }).event_id,
    userId,
    WORKSHOP_MANAGE_ROLE,
  );
}
