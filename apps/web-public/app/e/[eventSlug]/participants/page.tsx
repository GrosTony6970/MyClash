import Link from 'next/link';
import { getApiUrl } from '@/lib/api-url';
import { ParticipantsList } from './_components/ParticipantsList';
import type { ParticipantLike } from './_components/filter-participants';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface EventInfo {
  name: string;
  location: string | null;
  startDate: string;
  endDate: string;
  logoUrl: string | null;
  organizationName: string | null;
  organizationLogoUrl: string | null;
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
      location: typeof raw['location'] === 'string' ? raw['location'] : null,
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
    description: `Roster for ${event.name}${event.location ? ` in ${event.location}` : ''}.`,
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
                  className="h-16 w-16 rounded-xl border border-neutral-800 object-cover"
                />
              )}
              {event.organizationLogoUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={event.organizationLogoUrl}
                  alt=""
                  className="h-10 w-10 rounded-full border border-neutral-800 object-contain"
                />
              )}
            </div>
          )}
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wider text-neutral-500">Participants</p>
            <h1 className="text-2xl font-bold text-white sm:text-3xl">{event.name}</h1>
            {event.organizationName && (
              <p className="text-sm text-neutral-300">{event.organizationName}</p>
            )}
            {event.location && <p className="text-sm text-neutral-400">{event.location}</p>}
            <p className="text-sm text-neutral-500">
              {formatDateRange(event.startDate, event.endDate)}
            </p>
            <Link
              href={`/e/${eventSlug}/home`}
              className="mt-2 inline-block text-sm text-emerald-400 hover:text-emerald-300"
            >
              ← Back to event home
            </Link>
          </div>
        </header>
      )}

      <ParticipantsList eventSlug={eventSlug} participants={participants} />
    </main>
  );
}
