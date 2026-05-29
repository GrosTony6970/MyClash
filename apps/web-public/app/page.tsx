import { getApiUrl } from '@/lib/api-url';
import { t } from '@myclash/i18n';
import { EventsListSections } from './_components/EventsListSections';

// Next.js 16 defaults route segments to static rendering. The public
// landing page must always reflect the current published-events list
// (operators publish on the admin and expect their event to appear
// here within seconds), so we force fresh SSR on every request. The
// `cache: 'no-store'` on the fetch below covers the data layer; these
// exports cover the route-segment layer.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PublicEvent {
  id?: string | null;
  slug?: string | null;
  name?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
  logo_url?: string | null;
  tournament_count?: number | null;
  organizations?: {
    name?: string | null;
    slug?: string | null;
    logo_url?: string | null;
  } | null;
}

interface EventLoadResult {
  events: PublicEvent[];
  unavailable: boolean;
}

const visibleStatuses = new Set(['published', 'running', 'completed']);

async function fetchPublicEvents(): Promise<EventLoadResult> {
  const apiUrl = getApiUrl();
  const target = `${apiUrl}/api/v1/events`;

  try {
    const res = await fetch(target, { cache: 'no-store' });
    if (!res.ok) {
      // Surface WHICH failure path fired so operators / Sentry can
      // diagnose the next occurrence of the "Events are temporarily
      // unavailable" banner. Captured by @sentry/nextjs via the
      // console.error breadcrumb.
      let bodySnippet = '';
      try {
        bodySnippet = (await res.text()).slice(0, 500);
      } catch {
        // ignore — the body wasn't readable, status code is enough
      }
      // eslint-disable-next-line no-console
      console.error('[public-home] /events returned non-OK', {
        target,
        status: res.status,
        statusText: res.statusText,
        bodySnippet,
      });
      return { events: [], unavailable: true };
    }

    const events = ((await res.json()) as PublicEvent[])
      .filter((event) => visibleStatuses.has(event.status ?? ''))
      .filter((event) => event.slug || event.id);

    return { events, unavailable: false };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[public-home] /events fetch threw', {
      target,
      error: err instanceof Error ? { name: err.name, message: err.message } : err,
    });
    return { events: [], unavailable: true };
  }
}

export default async function HomePage() {
  const { events, unavailable } = await fetchPublicEvents();

  return (
    <main
      id="main-content"
      className="min-h-screen bg-neutral-950 px-4 py-6 text-neutral-50 sm:px-6"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <section className="border-y border-neutral-800 py-5">
          <p className="max-w-2xl text-lg font-semibold text-neutral-100">
            {t('publicApp.home.title')}
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
            {t('publicApp.home.subtitle')}
          </p>
        </section>

        {events.length > 0 ? (
          <EventsListSections events={events} />
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
          </section>
        )}
      </div>
    </main>
  );
}
