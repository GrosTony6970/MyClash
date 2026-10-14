'use client';

import Link from 'next/link';
import { useOrganizerSelectedEvent } from './organizer-event-context';

/**
 * The club's crumb at the head of a page's trail. It showed the club's slug
 * (`lyon-hema`), on sixteen pages (quick win X3): the name is already read by the
 * organiser's shell. The slug shows only until that read lands.
 */
export function OrgCrumb({ slug, className }: { slug: string; className?: string }) {
  const { orgName } = useOrganizerSelectedEvent();
  return (
    <Link href={`/org/${slug}`} className={className}>
      {orgName ?? slug}
    </Link>
  );
}

/**
 * The Event's crumb. It showed a word ("Event") where the shell already knows the
 * Event's name. `fallback` is the page's own word, shown until the Event list lands.
 */
export function EventCrumb({
  slug,
  eventId,
  className,
  fallback,
}: {
  slug: string;
  eventId: string;
  className?: string;
  fallback: string;
}) {
  const { currentEvent } = useOrganizerSelectedEvent();
  return (
    <Link href={`/org/${slug}/events/${eventId}`} className={className}>
      {currentEvent?.name || fallback}
    </Link>
  );
}
