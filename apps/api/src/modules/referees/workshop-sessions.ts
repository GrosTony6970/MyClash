/**
 * workshop-sessions.ts — who teaches and who attends each Workshop session of an Event,
 * and when, for the referee checker (ADR-016: teaching is Impossible, attending is
 * Discouraged).
 *
 * A session nobody runs is no commitment: a `cancelled` session is left out for both.
 * Attending means an enrolment the person said yes to — `confirmed` or `intent`, as the
 * /me Workshop list counts it (operator ruling 134); waitlisted, cancelled and refused do
 * not count. A session with no time yet (0028 made both ends optional) comes back with
 * null times, and the checker lets it overlap nothing.
 *
 * Identity: an instructor row carries a `global_persons.id`; an enrolment's `user_id` is
 * the EVENT-SCOPED `persons.id` (a guest has no account), so it is resolved to
 * `persons.global_person_id` here — the id-space the referee candidates live in.
 *
 * A failed read throws a plain Error (a 5xx): an empty answer would read as "nobody
 * teaches anything", which is an all-clear nobody checked.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface WorkshopSessionCommitments {
  sessionId: string;
  /** The Workshop's title: the data name a screen shows and a confirm stores. */
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  /** `global_persons.id` of each instructor. */
  instructorIds: string[];
  /** `global_persons.id` of each attendee. */
  attendeeIds: string[];
}

export const ATTENDING_STATUSES = ['confirmed', 'intent'] as const;

function dataOrThrow<T>(
  what: string,
  result: { data: unknown; error: { message: string } | null },
): T[] {
  if (result.error) throw new Error(`Could not read ${what}: ${result.error.message}`);
  return (result.data ?? []) as T[];
}

export async function loadWorkshopSessions(
  db: Pick<SupabaseClient, 'from'>,
  eventId: string,
): Promise<WorkshopSessionCommitments[]> {
  const workshops = dataOrThrow<{
    id: string;
    title: string;
    workshop_instructors: Array<{ global_person_id: string | null }> | null;
  }>(
    'the Workshops',
    await db
      .from('workshops')
      .select('id, title, workshop_instructors(global_person_id)')
      .eq('event_id', eventId),
  );
  if (workshops.length === 0) return [];

  const sessions = await runningSessions(
    db,
    workshops.map((w) => w.id),
  );
  if (sessions.length === 0) return [];

  const attendees = await attendeesBySession(
    db,
    sessions.map((s) => s.id),
  );
  const workshopById = new Map(workshops.map((w) => [w.id, w]));
  return sessions.map((s) => {
    const workshop = workshopById.get(s.workshop_id);
    return {
      sessionId: s.id,
      title: workshop?.title ?? '',
      startsAt: s.starts_at,
      endsAt: s.ends_at,
      instructorIds: (workshop?.workshop_instructors ?? [])
        .map((i) => i.global_person_id)
        .filter((id): id is string => id !== null),
      attendeeIds: attendees.get(s.id) ?? [],
    };
  });
}

/** The sessions of these Workshops that anybody still runs: a cancelled one is no commitment. */
async function runningSessions(db: Pick<SupabaseClient, 'from'>, workshopIds: string[]) {
  return dataOrThrow<{
    id: string;
    workshop_id: string;
    starts_at: string | null;
    ends_at: string | null;
  }>(
    'the Workshop sessions',
    await db
      .from('workshop_sessions')
      .select('id, workshop_id, starts_at, ends_at')
      .in('workshop_id', workshopIds)
      .neq('status', 'cancelled'),
  );
}

/** Session id → the global person ids attending it. */
async function attendeesBySession(
  db: Pick<SupabaseClient, 'from'>,
  sessionIds: string[],
): Promise<Map<string, string[]>> {
  const enrolments = dataOrThrow<{ workshop_session_id: string; user_id: string }>(
    'the Workshop enrolments',
    await db
      .from('workshop_enrollments')
      .select('workshop_session_id, user_id')
      .in('workshop_session_id', sessionIds)
      .in('status', [...ATTENDING_STATUSES]),
  );
  const out = new Map<string, string[]>();
  if (enrolments.length === 0) return out;

  const persons = dataOrThrow<{ id: string; global_person_id: string | null }>(
    'the enrolled people',
    await db
      .from('persons')
      .select('id, global_person_id')
      .in('id', [...new Set(enrolments.map((e) => e.user_id))]),
  );
  const globalOf = new Map(persons.map((p) => [p.id, p.global_person_id]));
  for (const e of enrolments) {
    const globalId = globalOf.get(e.user_id);
    if (!globalId) continue;
    const list = out.get(e.workshop_session_id) ?? [];
    list.push(globalId);
    out.set(e.workshop_session_id, list);
  }
  return out;
}
