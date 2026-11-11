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

/** What the page says about an instructor: the Workshop's words over the profile's (3.6). */
export interface InstructorAbout {
  bio: string | null;
  club: string | null;
  photoUrl: string | null;
}

export interface Instructor {
  globalPersonId: string | null;
  displayName: string;
  about?: InstructorAbout;
}

export interface Workshop {
  id: string;
  slug: string;
  title: string;
  shortDescription: string | null;
  descriptionMd: string | null;
  /** What a learner should know or bring (ruling 557). */
  prerequisites: string | null;
  category: string | null;
  level: string | null;
  /** The weapon's catalogue name, as on the list's cards. */
  weapon: string | null;
  language: string | null;
  color: string | null;
  /** The Workshop's square picture. */
  coverImageUrl: string | null;
  durationMinutes: number | null;
  eventTimezone: string | null;
  sessions: Session[];
  instructors: Instructor[];
  /** The signed-in caller teaches this workshop — no participant seat for them. */
  viewerIsInstructor: boolean;
}

/** Read at the first load, and again after every tap on a session. */
export function workshopPath(workshopSlug: string, eventSlug: string): string {
  return `/api/v1/workshops/slug/${encodeURIComponent(workshopSlug)}?eventSlug=${encodeURIComponent(eventSlug)}`;
}
