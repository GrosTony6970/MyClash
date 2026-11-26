import type { McpCaller, McpToolDeps } from '../mcp-server';

interface WorkshopSession {
  startsAt: string | null;
  endsAt: string | null;
  status: string | null;
  locationLabel: string | null;
  venue: { name: string } | null;
  area: { name: string } | null;
}

interface WorkshopOfGroup {
  title: string;
  level: string | null;
  weapon: string | null;
  sessions: WorkshopSession[];
}

interface GroupOf<W> {
  event: { slug: string; name: string; timezone: string | null };
  workshops: W[];
}

export interface MyWorkshopsAnswer {
  teaching: (WorkshopHead & {
    sessions: (SessionHead & { confirmed: number; waitlisted: number; capacity: number | null })[];
  })[];
  attended: (WorkshopHead & { instructors: string[]; sessions: SessionHead[] })[];
}

interface WorkshopHead {
  eventName: string;
  eventSlug: string;
  timezone: string | null;
  name: string;
  level: string | null;
  weapon: string | null;
}

interface SessionHead {
  start: string | null;
  end: string | null;
  location: string | null;
  cancelled: boolean;
}

function headOf<W extends WorkshopOfGroup>(group: GroupOf<W>, workshop: W): WorkshopHead {
  return {
    eventName: group.event.name,
    eventSlug: group.event.slug,
    timezone: group.event.timezone,
    name: workshop.title,
    level: workshop.level,
    weapon: workshop.weapon,
  };
}

/** Where a session is held: its own label first, then the area, then the venue. */
function sessionHead(s: WorkshopSession): SessionHead {
  return {
    start: s.startsAt,
    end: s.endsAt,
    location: s.locationLabel ?? s.area?.name ?? s.venue?.name ?? null,
    cancelled: s.status === 'cancelled',
  };
}

/**
 * The Workshops the person teaches and the ones they attend, as the personal space lists them
 * (test Events are already dropped by the service). A taught session carries its counts, which the
 * instructor page shows the instructor; no one who enrolled is named. An attended Workshop names
 * its instructors, as its public card does. Ids, descriptions and cover images are left out.
 */
export async function myWorkshops(
  caller: McpCaller,
  deps: McpToolDeps,
): Promise<MyWorkshopsAnswer> {
  const [teaching, attended] = await Promise.all([
    deps.meEvents.getInstructorWorkshops(caller.userId),
    deps.meEvents.getMyWorkshopHistory(caller.userId),
  ]);
  return {
    teaching: teaching.flatMap((group) =>
      group.workshops.map((w) => ({
        ...headOf(group, w),
        sessions: w.sessions.map((s) => ({
          ...sessionHead(s),
          confirmed: s.confirmedCount,
          waitlisted: s.waitlistCount,
          capacity: s.capacity,
        })),
      })),
    ),
    attended: attended.flatMap((group) =>
      group.workshops.map((w) => ({
        ...headOf(group, w),
        instructors: w.instructors.map((i) => i.displayName),
        sessions: w.sessions.map(sessionHead),
      })),
    ),
  };
}
