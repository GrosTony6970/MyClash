'use client';

import type { ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { ArchivedBanner } from './_components/ArchivedBanner';
import { useEventStatus } from './_hooks/useEventStatus';

export default function EventLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ slug: string; eventId: string }>();
  const { eventId } = params;
  const { event } = useEventStatus(eventId);

  return (
    <>
      {event?.status === 'archived' && (
        <ArchivedBanner eventId={eventId} eventName={event.name} updatedAt={event.updated_at} />
      )}
      {children}
    </>
  );
}
