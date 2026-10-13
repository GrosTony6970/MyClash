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
  type ScheduleAnswer,
  type ScheduleShown,
} from './schedule-state';
import type { PersonSchedule } from './types';

/** While the page is in view it reads again this often: the programme moves during the day. */
export const SCHEDULE_REREAD_MS = 60_000;
/** A read with no answer after this long has failed: `fetch` alone waits for ever on a dead link. */
export const SCHEDULE_READ_LIMIT_MS = 20_000;

export interface MySchedule<T> extends ScheduleShown<T> {
  loading: boolean;
  /** Read again now, keeping what is on screen meanwhile. */
  refresh: () => void;
  /** Read again from a page that shows no schedule: back to "loading". */
  retry: () => void;
}

/**
 * Reads a schedule now, and again when the signal returns, when the visitor
 * comes back to the page, and once a minute while it is in view. Each answer
 * goes to `take`. Returns what ends it.
 *
 * The race, named: two reads out at once, the older answering last. There is
 * never a second read: a tick that finds one out does nothing, so an answer is
 * never dropped for a newer ask (on a slow link that rule takes no answer at
 * all).
 */
function watchSchedule<T>(url: string, take: (answer: ScheduleAnswer<T>) => void): () => void {
  let gone = false;
  let out: AbortController | null = null;

  const read = () => {
    if (out) return;
    const mine = new AbortController();
    out = mine;
    const limit = setTimeout(() => mine.abort(), SCHEDULE_READ_LIMIT_MS);
    void readMySchedule<T>(url, mine.signal).then((answer) => {
      clearTimeout(limit);
      if (out === mine) out = null;
      // The page left, or asked again: this answer is nobody's.
      if (gone) return;
      // Ended by the limit, not by the page: a read that failed.
      take(answer.kind === 'aborted' ? { kind: 'failed' } : answer);
    });
  };
  const readIfInView = () => {
    if (document.visibilityState === 'visible') read();
  };

  read();
  const timer = setInterval(readIfInView, SCHEDULE_REREAD_MS);
  window.addEventListener('online', read);
  document.addEventListener('visibilitychange', readIfInView);
  return () => {
    gone = true;
    out?.abort();
    clearInterval(timer);
    window.removeEventListener('online', read);
    document.removeEventListener('visibilitychange', readIfInView);
  };
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

    const url = `${getPublicApiUrl()}/api/v1/events/${eventKey}/my-schedule`;
    return watchSchedule<T>(url, (answer) => {
      const now = Date.now();
      const kept = copyAfterRead(answer, now);
      if (kept === 'forget') forgetSchedule(eventKey);
      else if (kept !== 'leave') keepSchedule(eventKey, kept.write);
      setShown((before) => scheduleAfterRead(before, answer, now));
    });
  }, [eventKey, asked]);

  return { ...shown, loading: shown.state === 'loading', refresh, retry };
}
