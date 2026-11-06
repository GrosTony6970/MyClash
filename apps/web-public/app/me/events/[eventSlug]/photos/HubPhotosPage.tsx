'use client';

import { useParams } from 'next/navigation';
import {
  EventHubChrome,
  HubLoading,
  HubNotFound,
  HubReadFailed,
} from '@/components/me/EventHubChrome';
import { useMyEvents } from '@/components/me/hooks';
import type { PhotoTags } from '../../../../e/[eventSlug]/photos/_components/TagOptions';
import { MyPhotosPanel } from './MyPhotosPanel';

/** The hub's Photos tab: her Event from "my events", then the form and her photos. */
export function HubPhotosPage({ tags }: { tags: PhotoTags }) {
  const { eventSlug } = useParams<{ eventSlug: string }>();
  const { events, loading, error, retry } = useMyEvents();
  const myEvent = events?.find((e) => e.event.slug === eventSlug) ?? null;

  if (loading) return <HubLoading />;
  if (error) return <HubReadFailed onRetry={retry} />;
  if (!myEvent) return <HubNotFound />;

  return (
    <EventHubChrome myEvent={myEvent} active="photos">
      {/* Keyed by its Event: another Event's tab starts with an empty list and an empty queue. */}
      <MyPhotosPanel key={myEvent.event.id} myEvent={myEvent} tags={tags} />
    </EventHubChrome>
  );
}
