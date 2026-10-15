import type { ScheduleCopy } from './schedule-copy';
import type { ScheduleRead } from './read-my-schedule';

/**
 * What a schedule page shows, decided in one place for the guest page and the
 * personal space (quick win F10).
 *
 * - `shown`: a schedule is on screen. `offline` says the last read failed and
 *   this is the copy the phone kept: it is as old as `updatedAt`.
 * - `signedOut`: the server knows nobody here. NO copy is shown over that.
 * - `notFound`: no such Event, or one hidden from this visitor. NO copy either.
 * - `failed`: the read failed and the phone keeps nothing. The page offers Retry.
 */
export interface ScheduleShown<T> {
  state: 'loading' | 'shown' | 'signedOut' | 'notFound' | 'failed';
  schedule: T | null;
  /** When the server gave the schedule on screen (ms), for "Updated 14:02". */
  updatedAt: number | null;
  offline: boolean;
}

export const SCHEDULE_LOADING: ScheduleShown<never> = {
  state: 'loading',
  schedule: null,
  updatedAt: null,
  offline: false,
};

/** The page before its first answer: the phone's copy at once, or "loading". */
export function scheduleFromCopy<T>(copy: ScheduleCopy<T> | null): ScheduleShown<T> {
  if (!copy) return SCHEDULE_LOADING;
  return { state: 'shown', schedule: copy.schedule, updatedAt: copy.fetchedAt, offline: false };
}

/** An answer the page takes: `aborted` (the page left) never reaches here. */
export type ScheduleAnswer<T> = Exclude<ScheduleRead<T>, { kind: 'aborted' }>;

export function scheduleAfterRead<T>(
  shown: ScheduleShown<T>,
  answer: ScheduleAnswer<T>,
  now: number,
): ScheduleShown<T> {
  if (answer.kind === 'data') {
    return { state: 'shown', schedule: answer.data, updatedAt: now, offline: false };
  }
  // The server knows nobody here: what was on screen is not this visitor's to see.
  if (answer.kind === 'signedOut' || answer.kind === 'notFound') {
    return { state: answer.kind, schedule: null, updatedAt: null, offline: false };
  }
  // A failed read keeps what is on screen, and says it is old.
  if (shown.schedule) return { ...shown, state: 'shown', offline: true };
  // The server said it knows nobody, or no Event, here: a read that fails later does not unsay it.
  if (shown.state === 'signedOut' || shown.state === 'notFound') return shown;
  return { state: 'failed', schedule: null, updatedAt: null, offline: false };
}

/** What an answer does to the phone's copy: write it, remove it, or leave it. */
export function copyAfterRead<T>(
  answer: ScheduleAnswer<T>,
  now: number,
): { write: ScheduleCopy<T> } | 'forget' | 'leave' {
  if (answer.kind === 'data') return { write: { schedule: answer.data, fetchedAt: now } };
  return answer.kind === 'failed' ? 'leave' : 'forget';
}
