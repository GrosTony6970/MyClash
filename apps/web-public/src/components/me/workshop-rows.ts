// Pure merge for the /me event-overview Workshops section: combines workshops
// the user TEACHES (instructor) with those they ATTEND (enrolled) into one
// sorted list. A workshop the user both leads and attends shows once as
// teaching. Kept framework-free so it can be unit-tested in isolation.

import type { MyEventWorkshopTeaching, WorkshopEnrollment } from './types';

/** A row in the unified Workshops section — a workshop the user teaches or attends. */
export interface WorkshopRow {
  key: string;
  involvement: 'teaching' | 'attending';
  name: string;
  start: string | null;
  end: string | null;
  location: string | null;
  href: string;
}

/**
 * Teaching rows first, then attending rows (minus any workshop already listed as
 * teaching, matched by slug), the whole list sorted by session start with
 * unscheduled (null start) entries last.
 */
export function buildWorkshopRows(
  teaching: MyEventWorkshopTeaching[],
  attending: WorkshopEnrollment[],
  eventSlug: string,
): WorkshopRow[] {
  const teachingRows: WorkshopRow[] = teaching.map((w) => ({
    key: `teach-${w.workshopId}`,
    involvement: 'teaching',
    name: w.workshopName,
    start: w.sessionStart,
    end: w.sessionEnd,
    location: w.location,
    href: '/me/instructor',
  }));

  const teachingSlugs = new Set(
    teaching.map((w) => w.workshopSlug).filter((s): s is string => Boolean(s)),
  );

  const attendingRows: WorkshopRow[] = attending
    .filter((w) => !(w.workshopSlug && teachingSlugs.has(w.workshopSlug)))
    .map((w) => ({
      key: `att-${w.workshopId}`,
      involvement: 'attending',
      name: w.workshopName,
      start: w.sessionStart,
      end: w.sessionEnd,
      location: w.location,
      href: `/me/events/${eventSlug}/workshops`,
    }));

  return [...teachingRows, ...attendingRows].sort((a, b) => {
    if (!a.start && !b.start) return 0;
    if (!a.start) return 1;
    if (!b.start) return -1;
    return a.start.localeCompare(b.start);
  });
}
