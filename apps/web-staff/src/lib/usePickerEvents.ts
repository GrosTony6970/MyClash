'use client';

import { useEffect, useState } from 'react';
import { api } from './api';
import type { PickerEvent } from '../components/picker-events';

interface PickerEventsState {
  events: PickerEvent[];
  loading: boolean;
}

/**
 * The events a volunteer could sign into.
 *
 * Fetched only when the link carries no `?event=`. A printed QR code that names
 * its event is the fast path and must not pay for a list it will not show —
 * and on an event morning that link is how most volunteers arrive.
 *
 * Never surfaces an error state. A failed fetch leaves an empty list, and the
 * picker's empty copy points at the typed-slug fallback, which still works: the
 * event field stays on the form precisely so a broken or slow picker cannot
 * lock a volunteer out of their own event.
 */
export function usePickerEvents(enabled: boolean): PickerEventsState {
  const [events, setEvents] = useState<PickerEvent[]>([]);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api
      .get<PickerEvent[]>('/api/v1/staff-auth/events')
      .then((rows) => {
        if (!cancelled) setEvents(rows);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { events, loading };
}
