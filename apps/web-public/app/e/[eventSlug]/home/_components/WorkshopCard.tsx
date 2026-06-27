import Link from 'next/link';
import { t } from '@myclash/i18n';
import { formatInZone } from '@myclash/time';
import { accentClassFor } from '@myclash/ui';
import type { PublicWorkshop } from '../_lib/public-event-data';

/**
 * One workshop card — shared by the event home and the /workshops list. Shows
 * the session start AND end time.
 */
export function WorkshopCard({
  workshop: w,
  eventSlug,
  tz,
  className,
}: {
  workshop: PublicWorkshop;
  eventSlug: string;
  tz: string;
  className?: string;
}) {
  // The sessions embed is unordered — pick the earliest started one (mirrors
  // buildWorkshopEntries) rather than relying on array position.
  const session =
    [...w.sessions]
      .filter((s) => s.startsAt)
      .sort((a, b) => ((a.startsAt as string) < (b.startsAt as string) ? -1 : 1))[0] ??
    w.sessions[0] ??
    null;
  const instructorNames = w.instructors.map((i) => i.displayName);
  return (
    <Link
      href={`/e/${eventSlug}/w/${encodeURIComponent(w.slug)}`}
      className={`group relative flex min-h-32 flex-col justify-between overflow-hidden rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition-colors hover:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-500/40${className ? ` ${className}` : ''}`}
    >
      {w.color && (
        <span
          aria-hidden="true"
          className={`absolute inset-y-0 left-0 w-1 ${accentClassFor(w.color)}`}
        />
      )}
      <div className="min-w-0">
        <p className="font-display text-base font-semibold text-slate-900">{w.title}</p>
        {instructorNames.length > 0 && (
          <p className="mt-0.5 truncate text-sm text-slate-500">{instructorNames.join(', ')}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {w.category && (
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-slate-600">
              {w.category}
            </span>
          )}
          {w.level && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
              {w.level}
            </span>
          )}
          {w.durationMinutes != null && (
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-slate-500">
              {t('publicApp.fighterProfile.minutes', { count: w.durationMinutes })}
            </span>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-slate-500">
          {session?.startsAt &&
            formatInZone(session.startsAt, tz, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          {session?.startsAt &&
            session.endsAt &&
            ` – ${formatInZone(session.endsAt, tz, { hour: '2-digit', minute: '2-digit' })}`}
        </span>
        <span className="font-semibold text-red-700 group-hover:text-red-800">→</span>
      </div>
    </Link>
  );
}
