'use client';

import { useEffect, useState } from 'react';
import { getPublicApiUrl } from '@/lib/api-url';

type EventStatus = 'draft' | 'published' | 'running' | 'completed' | 'archived';

export function useEventStatus(eventId: string): {
  status: EventStatus | null;
  isReadOnly: boolean;
  isArchived: boolean;
  isLoading: boolean;
  refetch: () => void;
} {
  const apiUrl = getPublicApiUrl();
  const [status, setStatus] = useState<EventStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for an async fetch on mount; behaviour-preserving
    setIsLoading(true);
    fetch(`${apiUrl}/api/v1/events/${eventId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { status?: string } | null) => {
        if (cancelled) return;
        setStatus((data?.status ?? null) as EventStatus | null);
        setIsLoading(false);
      })
      .catch(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, eventId, refreshKey]);

  return {
    status,
    isReadOnly: status === 'archived',
    isArchived: status === 'archived',
    isLoading,
    refetch: () => setRefreshKey((k) => k + 1),
  };
}
