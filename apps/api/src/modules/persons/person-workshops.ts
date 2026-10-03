/**
 * person-workshops.ts — the Workshops of one person's schedule, by what each booking IS.
 *
 * A booking is a seat (`confirmed` or `intent`, as the referee checker counts it), a place on
 * the waitlist, or a refusal: the instructor's refusal keeps the row until the person cancels
 * it (ruling 219). Read with no status, all three came out as "attends": the person's Workshops
 * page said "Registered", and three schedules listed the Workshop.
 *
 * Who reads what:
 * - anybody the person's privacy lets in reads the SEATS;
 * - the person alone reads their waitlist places, marked (ruling 235), and their refusals
 *   (ruling 236). The filter is in SQL: a row the reader may not know never leaves the database.
 *   "The person" is whoever the caller resolves to: a guest session takes no proof (see
 *   `public-schedule.service.ts`), as it already did for Workshops a person hides.
 *
 * A refusal is no Workshop of the schedule, so it comes back apart, as the id of its session:
 * a screen that lists `workshops` cannot show one by mistake.
 *
 * A failed read throws a plain Error (a 5xx). An empty answer would read as "no booking", and
 * the person's page would offer "Register" on a seat they hold.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { ATTENDING_STATUSES } from '../referees/workshop-sessions';

export interface WorkshopEnrollment {
  /** workshop_sessions.id (the enrolled session), NOT the parent workshop id. */
  workshopId: string;
  /** Parent workshop slug — deep-links to the workshop in the Workshops tab. */
  workshopSlug: string | null;
  workshopName: string;
  sessionStart: string | null;
  sessionEnd: string | null;
  location: string | null;
  /** A seat, or a place on the waitlist (the person's own read only). */
  status: 'confirmed' | 'waitlisted';
}

export interface PersonWorkshops {
  workshops: WorkshopEnrollment[];
  /** workshop_sessions.id of each booking the instructor refused (the person's own read only). */
  refusedWorkshopIds: string[];
}

/** The states only the person reads about themself. */
const OWN_ONLY_STATUSES = ['waitlisted', 'refused'] as const;

type Row = Record<string, unknown>;
/** PostgREST embeds a to-one parent as an object; the typed client says array. */
const one = (embed: unknown): Row | null =>
  ((Array.isArray(embed) ? embed[0] : embed) as Row | null | undefined) ?? null;

export async function readPersonWorkshops(
  db: SupabaseClient,
  personId: string,
  own: boolean,
): Promise<PersonWorkshops> {
  // `user_id` is the event-scoped persons.id, so filtering by it already
  // scopes to this event — there is no `event_id` column on enrollments.
  const { data, error } = await db
    .from('workshop_enrollments')
    .select(
      `
      status,
      workshop_sessions (
        id, starts_at, ends_at, location_label,
        workshops ( title, slug )
      )
    `,
    )
    .eq('user_id', personId)
    .in('status', own ? [...ATTENDING_STATUSES, ...OWN_ONLY_STATUSES] : [...ATTENDING_STATUSES]);
  if (error) {
    throw new Error(`Could not read the Workshops of person ${personId}: ${error.message}`);
  }

  const workshops: WorkshopEnrollment[] = [];
  const refusedWorkshopIds: string[] = [];
  for (const booking of (data ?? []) as Row[]) {
    const session = one(booking['workshop_sessions']);
    const sessionId = (session?.['id'] as string) ?? '';
    if (booking['status'] === 'refused') {
      refusedWorkshopIds.push(sessionId);
      continue;
    }
    const workshop = one(session?.['workshops']) as { title?: string; slug?: string } | null;
    workshops.push({
      workshopId: sessionId,
      workshopSlug: workshop?.slug ?? null,
      workshopName: workshop?.title ?? '',
      sessionStart: (session?.['starts_at'] as string | null) ?? null,
      sessionEnd: (session?.['ends_at'] as string | null) ?? null,
      location: (session?.['location_label'] as string | null) ?? null,
      status: booking['status'] === 'waitlisted' ? 'waitlisted' : 'confirmed',
    });
  }
  return { workshops, refusedWorkshopIds };
}
