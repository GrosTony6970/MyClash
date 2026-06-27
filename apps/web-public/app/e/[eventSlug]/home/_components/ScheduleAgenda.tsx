import Link from 'next/link';
import { formatInZone } from '@myclash/time';
import { accentClassFor } from '@myclash/ui';
import { groupByDay, type ScheduleEntry } from '../_lib/schedule-entries';

/**
 * Day-by-day agenda used by the public tournament-schedule and workshop-schedule
 * pages. Renders the same entry-row style the home schedule section used to.
 */
export function ScheduleAgenda({
  entries,
  tz,
  emptyLabel,
}: {
  entries: ScheduleEntry[];
  tz: string;
  emptyLabel: string;
}) {
  const days = groupByDay(entries, tz);
  if (days.length === 0) {
    return <p className="text-sm text-slate-500">{emptyLabel}</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {days.map((day) => (
        <div key={day.dayKey}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            {formatInZone(day.repStart, tz, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {day.entries.map((entry) => (
              <Link
                key={entry.id}
                href={entry.href}
                className="group relative flex items-center gap-3 overflow-hidden rounded-xl border border-stone-200 bg-white p-3 pl-4 shadow-sm transition-colors hover:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-500/40"
              >
                <span
                  aria-hidden="true"
                  className={`absolute left-0 top-0 h-full w-1 ${accentClassFor(entry.color)}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs font-semibold text-slate-700">
                    {formatInZone(entry.startsAt, tz, { hour: '2-digit', minute: '2-digit' })}
                    {entry.endsAt &&
                      `–${formatInZone(entry.endsAt, tz, { hour: '2-digit', minute: '2-digit' })}`}
                  </p>
                  <p className="truncate font-display text-sm font-semibold text-slate-900">
                    {entry.title}
                  </p>
                  {entry.subtitle && (
                    <p className="truncate text-xs text-slate-500">{entry.subtitle}</p>
                  )}
                </div>
                <span className="shrink-0 font-semibold text-red-700 group-hover:text-red-800">
                  →
                </span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
