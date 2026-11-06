'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '@myclash/api-client';
import type { ProgrammeBlock } from '@myclash/types';
import { getPublicApiUrl } from '@/lib/api-url';
import type { MyEvent, UpcomingItem } from './types';

/**
 * All events the signed-in user is involved in (competitor / referee / workshops). A failed read,
 * or a body that is not a list, is `error` (ruling 461): the page says so and offers `retry`,
 * never "no Events". Read through `apiRequest`, so a login over an hour old is renewed.
 */
export function useMyEvents(): {
  events: MyEvent[] | null;
  loading: boolean;
  error: boolean;
  retry: () => void;
} {
  const [events, setEvents] = useState<MyEvent[] | null>(null);
  const [error, setError] = useState(false);
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<unknown>(getPublicApiUrl(), '/api/v1/me/events', {
      signal: controller.signal,
    }).then((res) => {
      if (!res.ok && res.kind === 'aborted') return;
      const list = res.ok && Array.isArray(res.data) ? (res.data as MyEvent[]) : null;
      setError(list === null);
      setEvents(list ?? []);
    });
    return () => controller.abort();
  }, [asked]);

  const retry = useCallback(() => {
    setError(false);
    setEvents(null);
    setAsked((n) => n + 1);
  }, []);

  return { events, loading: events === null, error, retry };
}

/** The event's programme blocks (lunch, ceremonies, competition windows…),
 *  read from the public programme endpoint. Used to weave non-commitment
 *  context (break/admin blocks) into the personal schedule. */
export function useProgramme(eventId: string | null): {
  blocks: ProgrammeBlock[];
  loading: boolean;
} {
  const [blocks, setBlocks] = useState<ProgrammeBlock[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) return;
    const controller = new AbortController();
    fetch(`${getPublicApiUrl()}/api/v1/events/${eventId}/programme`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.ok) {
          const data = (await res.json()) as ProgrammeBlock[];
          setBlocks(Array.isArray(data) ? data : []);
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLoading(false);
      });
    return () => controller.abort();
  }, [eventId]);

  return { blocks, loading };
}

/** Cross-event upcoming commitments for the dashboard "Next up". */
export function useUpcoming(limit = 4): { items: UpcomingItem[] | null } {
  const [items, setItems] = useState<UpcomingItem[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${getPublicApiUrl()}/api/v1/me/upcoming?limit=${limit}`, {
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
