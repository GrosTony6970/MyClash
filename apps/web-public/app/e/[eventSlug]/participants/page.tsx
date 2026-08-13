import Link from 'next/link';
import { BackLink } from '@/components/BackLink';
import { createTranslator, defaultLocale, getMessages, type Locale } from '@myclash/i18n';
import { localeToBcp47 } from '@myclash/time';
import { formatCountryName } from '@myclash/ui';
import { getServerApiUrl } from '@/lib/api-url';
import { getServerT, resolveServerLocale } from '@myclash/next-i18n/server';
import { FollowOrganizerButton } from '../../../_components/FollowOrganizerButton';
import { fetchEventInfo, type EventInfo } from '../_components/EventHeader';
import { ParticipantsTabbedView } from './_components/ParticipantsTabbedView';
import type { ParticipantLike } from './_components/filter-participants';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * This page keeps its own header band (no hero, no live pill, a "People"
 * eyebrow) but reads the event through the SHARED loader — the private copy it
 * used to have was a strict subset that quietly missed the organiser slug and
 * id, so the organiser stayed plain text here after every other event page had
 * started linking it.
 */
function formatEventPlace(event: Pick<EventInfo, 'city' | 'country'>): string | null {
  const countryName = formatCountryName(event.country, defaultLocale);
  const parts = [event.city, countryName].filter((v): v is string => Boolean(v));
  return parts.length === 0 ? null : parts.join(', ');
}

async function fetchParticipants(eventSlug: string): Promise<ParticipantLike[]> {
  const apiUrl = getServerApiUrl();
  try {
    const res = await fetch(
      `${apiUrl}/api/v1/events/${encodeURIComponent(eventSlug)}/participants?includeStaff=true`,
      { cache: 'no-store' },
    );
    if (!res.ok) return [];
    return (await res.json()) as ParticipantLike[];
  } catch {
    return [];
  }
}

function formatDateRange(start: string, end: string, locale: Locale): string {
  if (!start || !end) return '';
  const s = new Date(start);
  const e = new Date(end);
  const tag = localeToBcp47(locale);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
  if (s.getFullYear() !== e.getFullYear()) {
    return `${s.toLocaleDateString(tag, { ...opts, year: 'numeric' })} – ${e.toLocaleDateString(tag, { ...opts, year: 'numeric' })}`;
  }
  return `${s.getDate()}–${e.toLocaleDateString(tag, { ...opts, year: 'numeric' })}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}): Promise<{ title: string; description: string }> {
  const { eventSlug } = await params;
  const t = await getServerT();
  const event = await fetchEventInfo(eventSlug, getServerApiUrl());
  if (!event) return { title: t('publicApp.participants.metaTitleFallback'), description: '' };
  const place = formatEventPlace(event);
  return {
    title: t('publicApp.participants.metaTitle', { name: event.name }),
    description: place
      ? t('publicApp.participants.metaDescriptionWithPlace', { name: event.name, place })
      : t('publicApp.participants.metaDescription', { name: event.name }),
  };
}

export default async function ParticipantsPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const locale = await resolveServerLocale();
  const t = createTranslator(getMessages(locale));
  const [event, participants] = await Promise.all([
    fetchEventInfo(eventSlug, getServerApiUrl()),
    fetchParticipants(eventSlug),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
      {event && (
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start">
          {(event.logoUrl || event.organizationLogoUrl) && (
            <div className="flex items-center gap-2">
              {event.logoUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={event.logoUrl}
                  alt=""
                  className="h-16 w-16 rounded-xl border border-border object-cover"
                />
              )}
              {event.organizationLogoUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={event.organizationLogoUrl}
                  alt=""
                  className="h-10 w-10 rounded-full border border-border object-contain"
                />
              )}
            </div>
          )}
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              {t('publicApp.people.title')}
            </p>
            <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
              {event.name}
            </h1>
            {event.organizationName && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {event.organizationSlug ? (
                  <Link
                    href={`/o/${event.organizationSlug}`}
                    className="text-sm text-foreground-secondary hover:text-accent hover:underline"
                  >
                    {event.organizationName}
                  </Link>
                ) : (
                  <p className="text-sm text-foreground-secondary">{event.organizationName}</p>
                )}
                {event.organizationId && event.organizationSlug && (
                  <FollowOrganizerButton
                    organizationId={event.organizationId}
                    slug={event.organizationSlug}
                  />
                )}
              </div>
            )}
            {(() => {
              const place = formatEventPlace(event);
              return place ? <p className="text-sm text-muted">{place}</p> : null;
            })()}
            <p className="text-sm text-muted">
              {formatDateRange(event.startDate, event.endDate, locale)}
            </p>
            <BackLink
              href={`/e/${eventSlug}/home`}
              label={t('publicApp.tournament.backToEventHome')}
              className="mt-3"
            />
          </div>
        </header>
      )}

      <ParticipantsTabbedView eventSlug={eventSlug} participants={participants} />
    </main>
  );
}
