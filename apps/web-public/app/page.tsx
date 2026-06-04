import { getApiUrl } from '@/lib/api-url';
import { t } from '@myclash/i18n';
import { HomeTabs } from './_components/HomeTabs';
import type { PublicLeague } from './_components/PublicLeaguesSections';

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
  // Projected by /api/v1/events (Slice 1) so the Upcoming table can
  // render a League column without a per-event roundtrip.
  leagues?: Array<{ id: string; name: string; slug: string }> | null;
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

async function fetchPublicLeagues(): Promise<PublicLeague[]> {
  const apiUrl = getApiUrl();
  const target = `${apiUrl}/api/v1/leagues`;
  try {
    const res = await fetch(target, { cache: 'no-store' });
    if (!res.ok) {
      // Soft-fail so a public-leagues outage doesn't take the events
      // tab down with it. The Leagues tab renders its empty state and
      // the operator still has Events.
      // eslint-disable-next-line no-console
      console.error('[public-home] /leagues returned non-OK', {
        target,
        status: res.status,
        statusText: res.statusText,
      });
      return [];
    }
    return (await res.json()) as PublicLeague[];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[public-home] /leagues fetch threw', {
      target,
      error: err instanceof Error ? { name: err.name, message: err.message } : err,
    });
    return [];
  }
}

export default async function HomePage() {
  const [{ events, unavailable }, leagues] = await Promise.all([
    fetchPublicEvents(),
    fetchPublicLeagues(),
  ]);

  return (
    <main id="main-content" className="min-h-screen bg-stone-50 px-4 py-6 text-slate-900 sm:px-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <section className="border-y border-stone-200 py-5">
          <p className="max-w-2xl font-display text-2xl font-semibold text-slate-900">
            {t('publicApp.home.title')}
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            {t('publicApp.home.subtitle')}
          </p>
        </section>

        {events.length > 0 || leagues.length > 0 ? (
          <HomeTabs events={events} leagues={leagues} />
        ) : (
          <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="font-display text-lg font-semibold text-slate-900">
              {unavailable ? t('publicApp.home.unavailableTitle') : t('publicApp.home.emptyTitle')}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
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
