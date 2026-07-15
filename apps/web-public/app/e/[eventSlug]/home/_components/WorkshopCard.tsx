import Link from 'next/link';
import { createTranslator, getMessages, type Locale } from '@myclash/i18n';
import { formatInZone, localeToBcp47 } from '@myclash/time';
import { accentClassFor } from '@myclash/ui';
import type { PublicWorkshop } from '../_lib/public-event-data';

/**
 * One workshop card — shared by the event home and the /workshops list. Shows
 * the session start AND end time. Server component; takes the resolved locale.
 */
export function WorkshopCard({
  workshop: w,
  eventSlug,
  tz,
  locale,
  className,
}: {
  workshop: PublicWorkshop;
  eventSlug: string;
  tz: string;
  locale: Locale;
  className?: string;
}) {
  const t = createTranslator(getMessages(locale));
  const tag = localeToBcp47(locale);
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
      className={`group relative flex min-h-32 flex-col justify-between overflow-hidden rounded-xl border border-border bg-surface p-4 shadow-sm transition-colors hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40${className ? ` ${className}` : ''}`}
    >
      {w.color && (
        <span
          aria-hidden="true"
          className={`absolute inset-y-0 left-0 w-1 ${accentClassFor(w.color)}`}
        />
      )}
      <div className="flex min-w-0 items-start gap-2.5">
        {w.coverImageUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={w.coverImageUrl}
            alt=""
            className="h-10 w-10 flex-shrink-0 rounded-md object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-semibold text-foreground">{w.title}</p>
          {instructorNames.length > 0 && (
            <p className="mt-0.5 truncate text-sm text-muted">{instructorNames.join(', ')}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {w.category && (
              <span className="rounded-full bg-border px-2 py-0.5 text-xs text-foreground-secondary">
                {w.category}
              </span>
            )}
            {w.level && (
              <span className="rounded-full bg-info/10 px-2 py-0.5 text-xs text-info">
                {w.level}
              </span>
            )}
            {w.durationMinutes != null && (
              <span className="rounded-full bg-border px-2 py-0.5 text-xs text-muted">
                {t('publicApp.fighterProfile.minutes', { count: w.durationMinutes })}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-muted">
          {session?.startsAt &&
            formatInZone(
              session.startsAt,
              tz,
              {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              },
              tag,
            )}
          {session?.startsAt &&
            session.endsAt &&
            ` – ${formatInZone(session.endsAt, tz, { hour: '2-digit', minute: '2-digit' }, tag)}`}
        </span>
        <span className="font-semibold text-accent group-hover:text-accent-hover">→</span>
      </div>
    </Link>
  );
}
