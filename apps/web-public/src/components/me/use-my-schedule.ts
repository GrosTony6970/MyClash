'use client';

import { useCallback, useEffect, useState } from 'react';
import { getPublicApiUrl } from '@/lib/api-url';
import { readMySchedule } from './read-my-schedule';
import { forgetSchedule, keepSchedule, keptSchedule } from './schedule-copy';
import {
  copyAfterRead,
  SCHEDULE_LOADING,
  scheduleAfterRead,
  scheduleFromCopy,
  type ScheduleShown,
} from './schedule-state';
import type { PersonSchedule } from './types';
import { watchSchedule } from './watch-schedule';

export interface MySchedule<T> extends ScheduleShown<T> {
  loading: boolean;
  /** Read again now, keeping what is on screen meanwhile. */
  refresh: () => void;
  /** Read again from a page that shows no schedule: back to "loading". */
  retry: () => void;
}

/**
 * A person's own schedule at one Event, for the guest page (by the Event's
 * address) and the personal space (by its id): ONE reader of
 * `GET /events/:event/my-schedule`.
 *
 * It paints the phone's copy at once, then reads (`watchSchedule`). What an
 * answer does to the screen and to the copy is decided in `schedule-state.ts`.
 * `refresh` and `retry` end the read that is out and ask again: its answer may
 * be older than the change they follow.
 */
export function useMySchedule<T = PersonSchedule>(eventKey: string | null): MySchedule<T> {
  const [shown, setShown] = useState<ScheduleShown<T>>(SCHEDULE_LOADING);
  const [asked, setAsked] = useState(0);
  const refresh = useCallback(() => setAsked((n) => n + 1), []);
  const retry = useCallback(() => {
    setShown(SCHEDULE_LOADING);
    setAsked((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!eventKey) return;
    // The phone's copy first (it works with no signal), unless a schedule is on screen already.
    const copy = keptSchedule<T>(eventKey);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the copy lives in the phone's store, which the server's render cannot read
    if (copy) setShown((before) => (before.schedule ? before : scheduleFromCopy(copy)));

    const apiUrl = getPublicApiUrl();
    return watchSchedule<T>(
      (signal) => readMySchedule<T>(apiUrl, eventKey, signal),
      (answer) => {
        const now = Date.now();
        const kept = copyAfterRead(answer, now);
        if (kept === 'forget') forgetSchedule(eventKey);
        else if (kept !== 'leave') keepSchedule(eventKey, kept.write);
        setShown((before) => scheduleAfterRead(before, answer, now));
      },
    );
  }, [eventKey, asked]);

  return { ...shown, loading: shown.state === 'loading', refresh, retry };
}
