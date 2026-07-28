'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArchivedBanner } from './_components/ArchivedBanner';
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
    fetch(`${apiUrl}/api/v1/events/${eventId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: EventInfo | null) => {
        if (!cancelled) setEvent(data);
      })
      .catch(() => {
        if (!cancelled) setEvent(null);
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
