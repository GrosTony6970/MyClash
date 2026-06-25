/* eslint-disable myclash/no-literal-string -- pre-i18n public page (matches the workshops page). */

import { BackLink } from '@/components/BackLink';
import { defaultLocale } from '@myclash/i18n';
import { formatCountryName } from '@myclash/ui';
import { getApiUrl } from '@/lib/api-url';
import { ParticipantsTabbedView } from './_components/ParticipantsTabbedView';
import type { ParticipantLike } from './_components/filter-participants';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface EventInfo {
  name: string;
  city: string | null;
  country: string | null;
  startDate: string;
  endDate: string;
  logoUrl: string | null;
  organizationName: string | null;
  organizationLogoUrl: string | null;
}

function formatEventPlace(event: Pick<EventInfo, 'city' | 'country'>): string | null {
  const countryName = formatCountryName(event.country, defaultLocale);
  const parts = [event.city, countryName].filter((v): v is string => Boolean(v));
  return parts.length === 0 ? null : parts.join(', ');
}

async function fetchEventInfo(eventSlug: string): Promise<EventInfo | null> {
  const apiUrl = getApiUrl();
  try {
    const res = await fetch(`${apiUrl}/api/v1/events/${encodeURIComponent(eventSlug)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as Record<string, unknown>;
    const org = raw['organizations'] as { name?: string; logo_url?: string } | null;
    return {
      name: String(raw['name'] ?? ''),
      city: typeof raw['city'] === 'string' ? raw['city'] : null,
      country: typeof raw['country'] === 'string' ? raw['country'] : null,
      startDate: String(raw['start_date'] ?? ''),
      endDate: String(raw['end_date'] ?? ''),
      logoUrl: typeof raw['logo_url'] === 'string' ? String(raw['logo_url']) : null,
      organizationName: typeof org?.name === 'string' ? org.name : null,
      organizationLogoUrl: typeof org?.logo_url === 'string' ? org.logo_url : null,
    };
  } catch {
    return null;
  }
}

async function fetchParticipants(eventSlug: string): Promise<ParticipantLike[]> {
  const apiUrl = getApiUrl();
  try {
    const res = await fetch(
      `${apiUrl}/api/v1/events/${encodeURIComponent(eventSlug)}/participants`,
      { cache: 'no-store' },
    );
    if (!res.ok) return [];
    return (await res.json()) as ParticipantLike[];
  } catch {
    return [];
  }
}

function formatDateRange(start: string, end: string): string {
  if (!start || !end) return '';
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
  if (s.getFullYear() !== e.getFullYear()) {
    return `${s.toLocaleDateString('fr-FR', { ...opts, year: 'numeric' })} – ${e.toLocaleDateString('fr-FR', { ...opts, year: 'numeric' })}`;
  }
  return `${s.getDate()}–${e.toLocaleDateString('fr-FR', { ...opts, year: 'numeric' })}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}): Promise<{ title: string; description: string }> {
  const { eventSlug } = await params;
  const event = await fetchEventInfo(eventSlug);
  if (!event) return { title: 'Participants · MyClash', description: '' };
  return {
    title: `Participants · ${event.name} · MyClash`,
    description: `Roster for ${event.name}${formatEventPlace(event) ? ` in ${formatEventPlace(event)}` : ''}.`,
  };
}

export default async function ParticipantsPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const [event, participants] = await Promise.all([
    fetchEventInfo(eventSlug),
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
                  className="h-16 w-16 rounded-xl border border-stone-200 object-cover"
                />
              )}
              {event.organizationLogoUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={event.organizationLogoUrl}
                  alt=""
                  className="h-10 w-10 rounded-full border border-stone-200 object-contain"
                />
              )}
            </div>
          )}
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wider text-slate-500">Participants</p>
            <h1 className="font-display text-2xl font-bold text-slate-900 sm:text-3xl">
              {event.name}
            </h1>
            {event.organizationName && (
              <p className="text-sm text-slate-700">{event.organizationName}</p>
            )}
            {(() => {
              const place = formatEventPlace(event);
              return place ? <p className="text-sm text-slate-500">{place}</p> : null;
            })()}
            <p className="text-sm text-slate-500">
              {formatDateRange(event.startDate, event.endDate)}
            </p>
            <BackLink href={`/e/${eventSlug}/home`} label="Back to event home" className="mt-3" />
          </div>
        </header>
      )}

      <ParticipantsTabbedView eventSlug={eventSlug} participants={participants} />
    </main>
  );
}
