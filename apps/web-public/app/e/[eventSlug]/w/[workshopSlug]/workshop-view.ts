// What the public Workshop page reads: the Workshop, its sessions, and where it reads them.

export interface Session {
  id: string;
  startsAt: string | null;
  endsAt: string | null;
  locationLabel: string | null;
  capacity: number | null;
  confirmedCount: number;
  /** 'scheduled' | 'running' | 'completed' | 'cancelled' */
  status: string;
}

export interface Workshop {
  id: string;
  slug: string;
  title: string;
  shortDescription: string | null;
  descriptionMd: string | null;
  category: string | null;
  level: string | null;
  language: string | null;
  color: string | null;
  durationMinutes: number | null;
  eventTimezone: string | null;
  sessions: Session[];
  instructors: Array<{ globalPersonId: string | null; displayName: string }>;
  /** The signed-in caller teaches this workshop — no participant seat for them. */
  viewerIsInstructor: boolean;
}

/** Read at the first load, and again after every tap on a session. */
export function workshopPath(workshopSlug: string, eventSlug: string): string {
  return `/api/v1/workshops/slug/${encodeURIComponent(workshopSlug)}?eventSlug=${encodeURIComponent(eventSlug)}`;
}
