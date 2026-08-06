'use client';
import { formatMinuteSpan } from '@myclash/time';
import type { AppLocale } from '@myclash/time';
import { formatMatchClock } from '@myclash/ui';
import { dueForSec, elapsedSec, runningOverSec, startedLateSec } from './live-board-timing';
import type { BoardRow } from './types';

/**
 * The timing readout for one piste, as text.
 *
 * Returned as data rather than JSX so the desktop row, the phone card and the
 * wall can each place it themselves — they agree on WHAT is late, not on how
 * to lay it out.
 */
export interface TimingReadout {
  /** Elapsed on a running bout, or how overdue a scheduled one is. */
  clock: string | null;
  /** The reason this piste is behind, when it is. */
  behind: string | null;
  /** True when `behind` should read as a warning rather than as context. */
  warn: boolean;
}

export function timingReadout(
  row: BoardRow,
  nowMs: number,
  matchDurationMinutes: number,
  locale: AppLocale,
  t: (key: string, params?: Record<string, string | number>) => string,
): TimingReadout {
  if (!row.currentMatch) return { clock: null, behind: null, warn: false };
  const span = (sec: number) => formatMinuteSpan(sec * 1000, locale);

  const elapsed = elapsedSec(row, nowMs);
  if (elapsed !== null) {
    const over = runningOverSec(row, nowMs, matchDurationMinutes);
    const late = startedLateSec(row);
    // The bout clock stays MM:SS — it is a stopwatch a human watches tick.
    // Everything else is minute-scaled, because "over by 3 min" is what the
    // organizer acts on and seconds there are noise.
    return {
      clock: formatMatchClock(elapsed * 1000),
      behind:
        over !== null && over > 0
          ? t('organizer.live.timing.over', { span: span(over) })
          : late !== null && late > 0
            ? t('organizer.live.timing.startedLate', { span: span(late) })
            : null,
      warn: over !== null && over > 0,
    };
  }

  const due = dueForSec(row, nowMs);
  if (due !== null && due > 0) {
    return { clock: null, behind: t('organizer.live.timing.due', { span: span(due) }), warn: true };
  }
  return { clock: null, behind: null, warn: false };
}
