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
 *
 * The sessions the person TEACHES are a second read (`readPersonTeaching`): an instructor line
 * is no booking, and a screen that counts seats must not count one.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { ATTENDING_STATUSES } from '../referees/workshop-sessions';
import { PUBLIC_WORKSHOP_STATUSES } from '../workshops/workshop-visibility';

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
  /** The session was cancelled: shown struck through, no clash, holds nothing (rulings 526, 529). */
  sessionCancelled: boolean;
  /** Who teaches it, by the name the Workshop page shows — less anyone who hides their
   *  Workshops publicly (ruling 132), as that page drops them. */
  instructorNames: string[];
}

/** A session the person teaches (a `workshop_instructors` line of its Workshop). */
export interface WorkshopTeachingSession {
  /** workshop_sessions.id — the same id space as `WorkshopEnrollment.workshopId`. */
  sessionId: string;
  workshopSlug: string | null;
  workshopName: string;
  sessionStart: string | null;
  sessionEnd: string | null;
  location: string | null;
  /** The session was cancelled: struck through, no clash (rulings 526, 529). */
  sessionCancelled: boolean;
}

export interface PersonWorkshops {
  workshops: WorkshopEnrollment[];
  /** workshop_sessions.id of each booking the instructor refused (the person's own read only). */
  refusedWorkshopIds: string[];
}

/** The subset of these global persons who hide their Workshops publicly (`PrivacyService`). */
export type HiddenInstructors = (globalPersonIds: string[]) => Promise<Set<string>>;

/** The states only the person reads about themself. */
const OWN_ONLY_STATUSES = ['waitlisted', 'refused'] as const;

type Row = Record<string, unknown>;
/** PostgREST embeds a to-one parent as an object; the typed client says array. */
const one = (embed: unknown): Row | null =>
  ((Array.isArray(embed) ? embed[0] : embed) as Row | null | undefined) ?? null;

type InstructorLine = { global_person_id: string | null; display_name: string | null };

export async function readPersonWorkshops(
  db: SupabaseClient,
  personId: string,
  own: boolean,
  hiddenInstructors: HiddenInstructors,
): Promise<PersonWorkshops> {
  // `user_id` is the event-scoped persons.id, so filtering by it already
  // scopes to this event — there is no `event_id` column on enrollments.
  const { data, error } = await db
    .from('workshop_enrollments')
    .select(
      `
      status,
      workshop_sessions (
        id, starts_at, ends_at, location_label, status,
        workshops ( title, slug, workshop_instructors ( global_person_id, display_name ) )
      )
    `,
    )
    .eq('user_id', personId)
    .in('status', own ? [...ATTENDING_STATUSES, ...OWN_ONLY_STATUSES] : [...ATTENDING_STATUSES]);
  if (error) {
    throw new Error(`Could not read the Workshops of person ${personId}: ${error.message}`);
  }

  const bookings = (data ?? []) as Row[];
  const hidden = await hiddenInstructors(
    bookings.flatMap(linesOf).flatMap((line) => line.global_person_id ?? []),
  );

  const workshops: WorkshopEnrollment[] = [];
  const refusedWorkshopIds: string[] = [];
  for (const booking of bookings) {
    if (booking['status'] === 'refused') {
      refusedWorkshopIds.push((one(booking['workshop_sessions'])?.['id'] as string) ?? '');
    } else {
      workshops.push(toEnrollment(booking, hidden));
    }
  }
  return { workshops, refusedWorkshopIds };
}

/** The instructor lines of a booking's Workshop. */
const linesOf = (booking: Row): InstructorLine[] =>
  (one(one(booking['workshop_sessions'])?.['workshops'])?.['workshop_instructors'] ??
    []) as InstructorLine[];

/** A seat or a waitlist place, as a schedule card shows it; `hidden` instructors go unnamed. */
function toEnrollment(booking: Row, hidden: Set<string>): WorkshopEnrollment {
  const session = one(booking['workshop_sessions']);
  const workshop = one(session?.['workshops']) as { title?: string; slug?: string } | null;
  return {
    workshopId: (session?.['id'] as string) ?? '',
    workshopSlug: workshop?.slug ?? null,
    workshopName: workshop?.title ?? '',
    sessionStart: (session?.['starts_at'] as string | null) ?? null,
    sessionEnd: (session?.['ends_at'] as string | null) ?? null,
    location: (session?.['location_label'] as string | null) ?? null,
    status: booking['status'] === 'waitlisted' ? 'waitlisted' : 'confirmed',
    sessionCancelled: session?.['status'] === 'cancelled',
    instructorNames: linesOf(booking).flatMap((line) =>
      line.display_name && !(line.global_person_id && hidden.has(line.global_person_id))
        ? [line.display_name]
        : [],
    ),
  };
}

/**
 * The sessions this person teaches at this Event: every session of every Workshop with an
 * instructor line for their global person. A Workshop with no session yet gives no row — the
 * schedule lists what has a time to be at. A cancelled session comes back marked, as a booking
 * in one does. A failed read throws: an empty answer would read as "teaches nothing".
 *
 * A draft Workshop is the organiser's alone (`PUBLIC_WORKSHOP_STATUSES`): only the instructor's
 * own read shows it, as their event overview already does.
 */
export async function readPersonTeaching(
  db: SupabaseClient,
  eventId: string,
  globalPersonId: string,
  own: boolean,
): Promise<WorkshopTeachingSession[]> {
  const { data, error } = await db
    .from('workshop_instructors')
    .select(
      `
      workshops (
        slug, title, event_id, status,
        workshop_sessions ( id, starts_at, ends_at, location_label, status )
      )
    `,
    )
    .eq('global_person_id', globalPersonId);
  if (error) {
    throw new Error(`Could not read the Workshops taught by ${globalPersonId}: ${error.message}`);
  }

  return ((data ?? []) as Row[]).flatMap((line) => {
    const workshop = one(line['workshops']);
    if (!workshop || workshop['event_id'] !== eventId) return [];
    if (!own && !PUBLIC_WORKSHOP_STATUSES.includes(String(workshop['status']))) return [];
    const sessions = (workshop['workshop_sessions'] ?? []) as Row[];
    return sessions.map((session) => ({
      sessionId: String(session['id']),
      workshopSlug: (workshop['slug'] as string | null) ?? null,
      workshopName: (workshop['title'] as string | null) ?? '',
      sessionStart: (session['starts_at'] as string | null) ?? null,
      sessionEnd: (session['ends_at'] as string | null) ?? null,
      location: (session['location_label'] as string | null) ?? null,
      sessionCancelled: session['status'] === 'cancelled',
    }));
  });
}
