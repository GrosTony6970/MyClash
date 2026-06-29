'use client';

import { useCallback, useEffect, useState } from 'react';
import { getApiUrl } from '@/lib/api-url';
import type { MyEvent, PersonSchedule, UpcomingItem } from './types';

/** All events the signed-in user is involved in (competitor / referee / workshops). */
export function useMyEvents(): { events: MyEvent[] | null; loading: boolean; error: boolean } {
  const [events, setEvents] = useState<MyEvent[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${getApiUrl()}/api/v1/me/events`, { credentials: 'include', signal: controller.signal })
      .then(async (res) => {
        if (res.ok) setEvents((await res.json()) as MyEvent[]);
        else {
          setError(true);
          setEvents([]);
        }
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(true);
          setEvents([]);
        }
      });
    return () => controller.abort();
  }, []);

  return { events, loading: events === null, error };
}

/** The signed-in user's per-event schedule (fights + referee slots + workshops). */
export function useMySchedule(eventId: string | null): {
  schedule: PersonSchedule | null;
  loading: boolean;
  refresh: () => void;
} {
  const [schedule, setSchedule] = useState<PersonSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!eventId) return;
    const controller = new AbortController();
    fetch(`${getApiUrl()}/api/v1/events/${eventId}/my-schedule`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = res.ok ? ((await res.json()) as PersonSchedule) : null;
        if (data) setSchedule(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) setLoading(false);
      });
    return () => controller.abort();
  }, [eventId, refreshKey]);

  return { schedule, loading, refresh };
}

/** Cross-event upcoming commitments for the dashboard "Next up". */
export function useUpcoming(limit = 4): { items: UpcomingItem[] | null } {
  const [items, setItems] = useState<UpcomingItem[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${getApiUrl()}/api/v1/me/upcoming?limit=${limit}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.ok) setItems((await res.json()) as UpcomingItem[]);
        else setItems([]);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) setItems([]);
      });
    return () => controller.abort();
  }, [limit]);
  return { items };
}
