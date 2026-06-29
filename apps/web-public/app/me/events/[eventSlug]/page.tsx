'use client';

import { useParams } from 'next/navigation';
import { Skeleton } from '@myclash/ui';
import { EventHubChrome, HubLoading, HubNotFound } from '@/components/me/EventHubChrome';
import { ScheduleView } from '@/components/me/ScheduleView';
import { useMyEvents, useMySchedule } from '@/components/me/hooks';

/** Per-event hub — default tab is Schedule (the in-venue "where am I due next"). */
export default function HubSchedulePage() {
  const { eventSlug } = useParams<{ eventSlug: string }>();
  const { events, loading } = useMyEvents();
  const myEvent = events?.find((e) => e.event.slug === eventSlug) ?? null;

  if (loading) return <HubLoading />;
  if (!myEvent) return <HubNotFound />;

  return (
    <EventHubChrome event={myEvent.event} active="schedule">
      <ScheduleTab
        eventId={myEvent.event.id}
        timezone={myEvent.event.timezone}
        slug={myEvent.event.slug}
      />
    </EventHubChrome>
  );
}

function ScheduleTab({
  eventId,
  timezone,
  slug,
}: {
  eventId: string;
  timezone: string | null;
  slug: string;
}) {
  const { schedule, loading, updatedAt, offline } = useMySchedule(eventId);
  if (loading || !schedule) return <Skeleton className="h-40 w-full rounded-xl" />;
  return (
    <ScheduleView
      schedule={schedule}
      timezone={timezone}
      eventSlug={slug}
      updatedAt={updatedAt}
      offline={offline}
    />
  );
}
