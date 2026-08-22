'use client';

import { useEffect, useState } from 'react';
import { getPublicApiUrl } from '@/lib/api-url';
import { apiRequest } from '@myclash/api-client';

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
    // Silent by design: this hook renders nothing itself, it hands a status to
    // the screens around it, and `null` is the honest answer when the read did
    // not land.
    void apiRequest<{ status?: string }>(apiUrl, `/api/v1/events/${eventId}`).then((r) => {
      if (cancelled) return;
      setStatus(r.ok ? ((r.data.status ?? null) as EventStatus | null) : null);
      setIsLoading(false);
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
