'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArchivedBanner } from './_components/ArchivedBanner';
import { apiRequest } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';

interface EventInfo {
  id: string;
  name: string;
  status: string;
  updated_at?: string | null;
}

export default function EventLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ slug: string; eventId: string }>();
  const { eventId } = params;
  const apiUrl = getPublicApiUrl();

  const [event, setEvent] = useState<EventInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Silent by design: the only thing this read decides is whether to draw the
    // archived banner, and the screen below it reports its own failures.
    void apiRequest<EventInfo>(apiUrl, `/api/v1/events/${eventId}`).then((r) => {
      if (!cancelled) setEvent(r.ok ? r.data : null);
    });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, eventId]);

  return (
    <>
      {event?.status === 'archived' && (
        <ArchivedBanner eventId={eventId} eventName={event.name} updatedAt={event.updated_at} />
      )}
      {children}
    </>
  );
}
