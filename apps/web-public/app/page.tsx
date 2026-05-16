import Image from 'next/image';
import Link from 'next/link';
import { t } from '@myclash/i18n';

interface PublicEvent {
  id?: string | null;
  slug?: string | null;
  name?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
  organizations?: {
    name?: string | null;
    slug?: string | null;
  } | null;
}

interface EventLoadResult {
  events: PublicEvent[];
  unavailable: boolean;
}

const visibleStatuses = new Set(['published', 'running', 'completed']);

async function fetchPublicEvents(): Promise<EventLoadResult> {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  try {
    const res = await fetch(`${apiUrl}/api/v1/events`, { cache: 'no-store' });
    if (!res.ok) return { events: [], unavailable: true };

    const events = ((await res.json()) as PublicEvent[])
      .filter((event) => visibleStatuses.has(event.status ?? ''))
      .filter((event) => event.slug || event.id);

    return { events, unavailable: false };
  } catch {
    return { events: [], unavailable: true };
  }
}

function formatDateRange(event: PublicEvent): string | null {
  if (!event.start_date || !event.end_date) return null;

  const start = new Date(event.start_date);
  const end = new Date(event.end_date);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  const monthDay: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (start.getFullYear() !== end.getFullYear()) {
    return `${start.toLocaleDateString(undefined, { ...monthDay, year: 'numeric' })} - ${end.toLocaleDateString(undefined, { ...monthDay, year: 'numeric' })}`;
  }

  if (start.toDateString() === end.toDateString()) {
    return start.toLocaleDateString(undefined, { ...monthDay, year: 'numeric' });
  }

  return `${start.toLocaleDateString(undefined, monthDay)} - ${end.toLocaleDateString(undefined, { ...monthDay, year: 'numeric' })}`;
}

function statusLabel(status: string | null | undefined): string {
  if (status === 'running') return t('publicApp.home.statusRunning');
  if (status === 'completed') return t('publicApp.home.statusCompleted');
  return t('publicApp.home.statusPublished');
}

export default async function HomePage() {
  const { events, unavailable } = await fetchPublicEvents();

  return (
    <main
      id="main-content"
      className="min-h-screen bg-neutral-950 px-4 py-6 text-neutral-50 sm:px-6"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Image
              src="/brand/Logo_nobackground.png"
              alt={t('app.name')}
              width={72}
              height={72}
              priority
              className="h-16 w-16"
            />
            <div>
              <h1 className="text-3xl font-bold">{t('app.name')}</h1>
              <p className="mt-1 text-sm text-neutral-400">{t('publicApp.home.description')}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/login"
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-700"
            >
              {t('publicApp.home.signIn')}
            </Link>
            <Link
              href="/me"
              className="rounded-md border border-neutral-700 px-4 py-2 text-sm font-bold text-neutral-100 transition hover:border-blue-400 hover:bg-blue-500/10"
            >
              {t('publicApp.home.personalSpace')}
            </Link>
          </div>
        </header>

        <section className="border-y border-neutral-800 py-5">
          <p className="max-w-2xl text-lg font-semibold text-neutral-100">
            {t('publicApp.home.title')}
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
            {t('publicApp.home.subtitle')}
          </p>
        </section>

        {events.length > 0 ? (
          <section aria-labelledby="public-events-title">
            <h2 id="public-events-title" className="text-base font-semibold text-neutral-200">
              {t('publicApp.home.eventsTitle')}
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {events.map((event) => {
                const eventKey = event.slug ?? event.id ?? event.name ?? '';
                const href = `/e/${encodeURIComponent(event.slug ?? event.id ?? '')}/home`;
                const dateRange = formatDateRange(event);

                return (
                  <Link
                    key={eventKey}
                    href={href}
                    className="group flex min-h-44 flex-col justify-between rounded-lg border border-neutral-800 bg-neutral-900 p-4 transition-colors hover:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-lg font-bold text-white">
                          {event.name ?? t('publicApp.home.unknownEvent')}
                        </p>
                        <span className="rounded-full border border-neutral-700 px-2 py-1 text-xs font-semibold text-neutral-300">
                          {statusLabel(event.status)}
                        </span>
                      </div>
                      {event.organizations?.name && (
                        <p className="mt-2 text-sm text-neutral-400">{event.organizations.name}</p>
                      )}
                      {event.location && (
                        <p className="mt-1 text-sm text-neutral-500">{event.location}</p>
                      )}
                    </div>
                    <div className="mt-6 flex items-center justify-between gap-3 text-sm">
                      <span className="text-neutral-400">{dateRange}</span>
                      <span className="font-semibold text-red-300 group-hover:text-red-200">
                        {t('publicApp.home.openEvent')}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        ) : (
          <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="text-lg font-semibold">
              {unavailable ? t('publicApp.home.unavailableTitle') : t('publicApp.home.emptyTitle')}
            </h2>
            <p className="mt-2 text-sm leading-6 text-neutral-400">
              {unavailable
                ? t('publicApp.home.unavailableDescription')
                : t('publicApp.home.emptyDescription')}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                href="/login"
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-700"
              >
                {t('publicApp.home.signIn')}
              </Link>
              <Link
                href="/me"
                className="rounded-md border border-neutral-700 px-4 py-2 text-sm font-bold text-neutral-100 transition hover:border-blue-400 hover:bg-blue-500/10"
              >
                {t('publicApp.home.personalSpace')}
              </Link>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
