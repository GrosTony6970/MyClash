'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ProgrammeBlock } from '@myclash/types';
import { getPublicApiUrl } from '@/lib/api-url';
import type { MyEvent, PersonSchedule, UpcomingItem } from './types';

// Stale-while-revalidate cache for the in-venue schedule: the last payload is
// kept per event in localStorage so the page paints instantly — even with no
// signal between bouts — and is replaced once the network responds.
const SCHEDULE_CACHE_PREFIX = 'myclash:schedule:';

interface ScheduleCache {
  schedule: PersonSchedule;
  fetchedAt: number;
}

function readScheduleCache(eventId: string): ScheduleCache | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${SCHEDULE_CACHE_PREFIX}${eventId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ScheduleCache;
    return parsed?.schedule ? parsed : null;
  } catch {
    return null;
  }
}

function writeScheduleCache(eventId: string, value: ScheduleCache): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${SCHEDULE_CACHE_PREFIX}${eventId}`, JSON.stringify(value));
  } catch {
    // ignore — storage full / private mode; the cache just won't persist
  }
}

/** All events the signed-in user is involved in (competitor / referee / workshops). */
export function useMyEvents(): { events: MyEvent[] | null; loading: boolean; error: boolean } {
  const [events, setEvents] = useState<MyEvent[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${getPublicApiUrl()}/api/v1/me/events`, {
      credentials: 'include',
      signal: controller.signal,
    })
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

/** The signed-in user's per-event schedule (fights + referee slots + workshops).
 *  Reads stale-while-revalidate from localStorage so the schedule paints
 *  instantly — even offline — then refreshes from the network and on reconnect.
 *  `updatedAt` (ms) + `offline` drive the "Updated HH:MM · offline" badge. */
export function useMySchedule(eventId: string | null): {
  schedule: PersonSchedule | null;
  loading: boolean;
  updatedAt: number | null;
  offline: boolean;
  refresh: () => void;
} {
  const [schedule, setSchedule] = useState<PersonSchedule | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!eventId) return;
    const controller = new AbortController();

    // Instant paint from the last cached payload (works with no signal) before
    // the network resolves; the live fetch below supersedes it on success.
    const cached = readScheduleCache(eventId);
    if (cached) {
      /* eslint-disable react-hooks/set-state-in-effect -- one-time cache hydration, superseded by the live fetch */
      setSchedule(cached.schedule);
      setUpdatedAt(cached.fetchedAt);
      setLoading(false);
      /* eslint-enable react-hooks/set-state-in-effect */
    }

    fetch(`${getPublicApiUrl()}/api/v1/events/${eventId}/my-schedule`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          setLoading(false);
          return;
        }
        const data = (await res.json()) as PersonSchedule;
        const now = Date.now();
        setSchedule(data);
        setUpdatedAt(now);
        setOffline(false);
        setLoading(false);
        writeScheduleCache(eventId, { schedule: data, fetchedAt: now });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // Network failure → keep whatever cache is on screen, flag offline.
        setOffline(true);
        setLoading(false);
      });

    return () => controller.abort();
  }, [eventId, refreshKey]);

  // Revalidate as soon as connectivity returns.
  useEffect(() => {
    const onOnline = () => refresh();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [refresh]);

  return { schedule, loading, updatedAt, offline, refresh };
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
