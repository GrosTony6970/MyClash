import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getServerApiUrl } from '@/lib/api-url';
import { requestLoginHeader } from '@/lib/login-cookie';
import { fetchEventInfo, type EventInfo } from '../_components/EventHeader';
import type { EventRead } from './event-read';

/**
 * The Event of the page being drawn, read ONCE per request: a page, its title
 * and its helpers all ask here, and `cache` makes that one read.
 *
 * It sends the visitor's login, so a club member reads their own draft or test
 * Event. For a server component only.
 */
export const readEventOnce = cache(async (eventSlug: string): Promise<EventRead> =>
  fetchEventInfo(eventSlug, getServerApiUrl(), { headers: await requestLoginHeader() }),
);

/**
 * The Event, or the page that says why there is none (quick win F13): an Event
 * that does not exist is the not-found page; a read that failed throws, so the
 * segment's error page offers "Try again". Never a page with the Event left out.
 */
export async function eventOrNotFound(eventSlug: string): Promise<EventInfo> {
  const read = await readEventOnce(eventSlug);
  if (read.kind === 'found') return read.event;
  if (read.kind === 'notFound') notFound();
  throw new Error(`The read of the Event "${eventSlug}" failed`);
}
