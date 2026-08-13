import { getServerApiUrl } from '@/lib/api-url';
import { getServerT } from '@myclash/next-i18n/server';
import { HomeTabs } from './HomeTabs';
import type { PublicLeague } from './PublicLeaguesSections';
import type { WeaponOption } from './EventFilterBar';
import {
  EMPTY_EVENT_FILTERS,
  hasAnyFilter,
  toEventQueryString,
  type EventFilters,
} from './event-filters';

/**
 * Public-events browser: fetches the published events + leagues and renders the
 * Events/Leagues tabs (or the empty / unavailable state).
 *
 * It renders only the listing (no page chrome / heading); the caller wraps it in
 * its own layout.
 *
 * This used to carry a `personal` flag, described as serving a personal-space
 * "Public events" tab that routed cards to /me/events/<slug> inside the personal
 * shell. No caller ever passed it, so that branch — threaded through six
 * components down to eventHref — was unreachable. Removed rather than
 * documented, because a dead parameter reads as a live feature.
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

async function fetchPublicEvents(filters: EventFilters): Promise<EventLoadResult> {
  const apiUrl = getServerApiUrl();
  const qs = toEventQueryString(filters);
  const target = `${apiUrl}/api/v1/events${qs ? `?${qs}` : ''}`;

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
      console.error('[public-events] /events returned non-OK', {
        target,
        status: res.status,
        statusText: res.statusText,
        bodySnippet,
      });
      return { events: [], unavailable: true };
    }

    // No status filter here any more — GET /events already restricts to
    // published/running/completed, and re-filtering client-side would silently
    // fight any future status the API decides is public.
    const events = ((await res.json()) as PublicEvent[]).filter((event) => event.slug || event.id);

    return { events, unavailable: false };
  } catch (err) {
    console.error('[public-events] /events fetch threw', {
      target,
      error: err instanceof Error ? { name: err.name, message: err.message } : err,
    });
    return { events: [], unavailable: true };
  }
}

async function fetchPublicLeagues(): Promise<PublicLeague[]> {
  const apiUrl = getServerApiUrl();
  const target = `${apiUrl}/api/v1/leagues`;
  try {
    const res = await fetch(target, { cache: 'no-store' });
    if (!res.ok) {
      // Soft-fail so a public-leagues outage doesn't take the events
      // tab down with it. The Leagues tab renders its empty state and
      // the operator still has Events.
      console.error('[public-events] /leagues returned non-OK', {
        target,
        status: res.status,
        statusText: res.statusText,
      });
      return [];
    }
    return (await res.json()) as PublicLeague[];
  } catch (err) {
    console.error('[public-events] /leagues fetch threw', {
      target,
      error: err instanceof Error ? { name: err.name, message: err.message } : err,
    });
    return [];
  }
}

async function fetchWeapons(): Promise<WeaponOption[]> {
  const apiUrl = getServerApiUrl();
  try {
    const res = await fetch(`${apiUrl}/api/v1/weapons?active=true`, { cache: 'no-store' });
    if (!res.ok) return [];
    return (await res.json()) as WeaponOption[];
  } catch {
    // Soft-fail like the leagues fetch: losing the weapon catalogue should
    // cost the user one filter option, not the whole page.
    return [];
  }
}

export async function PublicEventsBrowser({
  filters = EMPTY_EVENT_FILTERS,
}: {
  filters?: EventFilters;
} = {}) {
  const t = await getServerT();
  const [{ events, unavailable }, leagues, weapons] = await Promise.all([
    fetchPublicEvents(filters),
    fetchPublicLeagues(),
    fetchWeapons(),
  ]);

  const filtered = hasAnyFilter(filters);

  if (events.length > 0 || leagues.length > 0) {
    return <HomeTabs events={events} leagues={leagues} weapons={weapons} filters={filters} />;
  }

  // A filtered search that matched nothing is not the same as an empty
  // platform. Keep the bar mounted so the user can widen or clear, instead of
  // stranding them on "no events yet" with no way back.
  if (filtered && !unavailable) {
    return <HomeTabs events={events} leagues={leagues} weapons={weapons} filters={filters} />;
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
        {unavailable ? t('publicApp.home.unavailableTitle') : t('publicApp.home.emptyTitle')}
      </h2>
      <p className="mt-2 text-sm leading-6 text-foreground-secondary">
        {unavailable
          ? t('publicApp.home.unavailableDescription')
          : t('publicApp.home.emptyDescription')}
      </p>
    </section>
  );
}
