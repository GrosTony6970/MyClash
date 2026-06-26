import { getApiUrl } from '@/lib/api-url';
import { t } from '@myclash/i18n';
import { HomeTabs } from './HomeTabs';
import type { PublicLeague } from './PublicLeaguesSections';

/**
 * Shared public-events browser: fetches the published events + leagues and
 * renders the Events/Leagues tabs (or the empty / unavailable state). Used by
 * both the public landing page and the personal-space "Public events" tab so
 * the latter shows the same listing inside the personal shell instead of
 * bouncing to the marketing home.
 *
 * It renders only the listing (no page chrome / heading); each caller wraps it
 * in its own layout.
 */
interface PublicEvent {
  id?: string | null;
  slug?: string | null;
  name?: string | null;
  city?: string | null;
  country?: string | null;
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
      console.error('[public-events] /events returned non-OK', {
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
    console.error('[public-events] /events fetch threw', {
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
      console.error('[public-events] /leagues returned non-OK', {
        target,
        status: res.status,
        statusText: res.statusText,
      });
      return [];
    }
    return (await res.json()) as PublicLeague[];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[public-events] /leagues fetch threw', {
      target,
      error: err instanceof Error ? { name: err.name, message: err.message } : err,
    });
    return [];
  }
}

export async function PublicEventsBrowser({ personal = false }: { personal?: boolean } = {}) {
  const [{ events, unavailable }, leagues] = await Promise.all([
    fetchPublicEvents(),
    fetchPublicLeagues(),
  ]);

  if (events.length > 0 || leagues.length > 0) {
    return <HomeTabs events={events} leagues={leagues} personal={personal} />;
  }

  return (
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
  );
}
