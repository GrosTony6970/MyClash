'use client';

import { useClock } from '../hooks/useNow';
import type { Translator } from '../types/translator';

const BADGE_TIME: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' };

interface SimulatedTimeBadgeProps {
  /** API base URL — varies per app (web-admin / web-public). */
  apiUrl: string;
  t: Translator;
  /** The BCP 47 tag the time is written in: `localeToBcp47(locale)`. */
  bcp47Locale: string;
}

/**
 * Fixed badge shown only while a super-admin time simulation drives the
 * clock, so visitors, organisers and testers can see a screen is running off
 * a shifted (or paused) clock rather than real time. Reads the same
 * runtime-flags poll the maintenance banner already drives (no extra network
 * cost) and the same clock the schedules use, so the value it shows is the
 * one the screen around it runs on.
 *
 * To the minute, on the 30 s clock: seconds that stand still for 30 s would
 * make a running clock look paused beside a board's 1 Hz timers. No live
 * region either — a screen reader would read it out every time it moves.
 *
 * Hidden for a flag that is on but carries no usable date: that simulation
 * moves no clock, so a badge would claim something false.
 */
export function SimulatedTimeBadge({ apiUrl, t, bcp47Locale }: SimulatedTimeBadgeProps) {
  const { nowMs, simulated, frozen } = useClock(apiUrl);
  if (!simulated) return null;

  const time = new Date(nowMs).toLocaleString(bcp47Locale, BADGE_TIME);

  return (
    <div className="fixed bottom-3 right-3 z-overlay flex items-center gap-2 rounded-full border border-warning/40 bg-warning/15 px-3 py-1.5 text-xs font-semibold text-warning shadow-sm backdrop-blur">
      <span
        className={`h-1.5 w-1.5 rounded-full bg-warning ${frozen ? '' : 'animate-pulse motion-reduce:animate-none'}`}
        aria-hidden
      />
      {frozen
        ? t('common.simulatedTime.paused', { time })
        : t('common.simulatedTime.running', { time })}
    </div>
  );
}
