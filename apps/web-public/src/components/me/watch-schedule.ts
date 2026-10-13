import type { ScheduleRead } from './read-my-schedule';
import type { ScheduleAnswer } from './schedule-state';

/** While the page is in view it reads again this often: the programme moves during the day. */
export const SCHEDULE_REREAD_MS = 60_000;
/** A read with no answer after this long has failed: `fetch` alone waits for ever on a dead link. */
export const SCHEDULE_READ_LIMIT_MS = 20_000;

/**
 * Reads a schedule now, and again when the signal returns, when the visitor
 * comes back to the page, and once a minute while it is in view. Each answer
 * goes to `take`. Returns what ends it.
 *
 * The race, named: two reads out at once, the older answering last. There is
 * never a second read: a tick that finds one out does nothing, so an answer is
 * never dropped for a newer ask (on a slow link that rule takes no answer at
 * all).
 *
 * No React here, so its rules are tested by running it (`watch-schedule.test.ts`).
 */
export function watchSchedule<T>(
  readOnce: (signal: AbortSignal) => Promise<ScheduleRead<T>>,
  take: (answer: ScheduleAnswer<T>) => void,
): () => void {
  let gone = false;
  let out: AbortController | null = null;

  const read = () => {
    if (out) return;
    const mine = new AbortController();
    out = mine;
    const limit = setTimeout(() => mine.abort(), SCHEDULE_READ_LIMIT_MS);
    void readOnce(mine.signal).then((answer) => {
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
