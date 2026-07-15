/* eslint-disable @next/next/no-img-element -- storage host not whitelisted in next.config remotePatterns yet; plain <img> matches the rest of the public app. */

/**
 * EventHeader — the shared event identity band used across the public event
 * pages (home, workshop detail, …): optional hero image + org logo, event
 * name, org name, place, date range, a "Live now" pill, and the public landing
 * blurb. Extracted from PublicHome so every event page reads identically.
 *
 * Presentational + a colocated `fetchEventInfo` loader. No hooks, so it renders
 * in both server (PublicHome) and client (workshop detail) components.
 */
import { createTranslator, getMessages, type Locale } from '@myclash/i18n';
import { localeToBcp47 } from '@myclash/time';
import { formatCountryName } from '@myclash/ui';

export interface EventInfo {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  startDate: string;
  endDate: string;
  publicLandingMd: string | null;
  status: string;
  timezone: string;
  logoUrl: string | null;
  heroImageUrl: string | null;
  organizationName: string | null;
  organizationLogoUrl: string | null;
}

function formatEventPlace(
  event: Pick<EventInfo, 'city' | 'country'>,
  locale: Locale,
): string | null {
  const countryName = formatCountryName(event.country, locale);
  const parts = [event.city, countryName].filter((v): v is string => Boolean(v));
  return parts.length === 0 ? null : parts.join(', ');
}

function formatDateRange(start: string, end: string, locale: Locale): string {
  const s = new Date(start);
  const e = new Date(end);
  const tag = localeToBcp47(locale);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
  if (s.getFullYear() !== e.getFullYear()) {
    return `${s.toLocaleDateString(tag, { ...opts, year: 'numeric' })} – ${e.toLocaleDateString(tag, { ...opts, year: 'numeric' })}`;
  }
  if (s.getMonth() !== e.getMonth()) {
    return `${s.toLocaleDateString(tag, opts)} – ${e.toLocaleDateString(tag, { ...opts, year: 'numeric' })}`;
  }
  return `${s.getDate()}–${e.toLocaleDateString(tag, { ...opts, year: 'numeric' })}`;
}

export async function fetchEventInfo(eventSlug: string, apiUrl: string): Promise<EventInfo | null> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/events/${encodeURIComponent(eventSlug)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as Record<string, unknown>;
    const org = raw['organizations'] as { name?: string; logo_url?: string } | null;
    // Supabase projects `themes(*)` either as a single object or as an array
    // depending on the joined cardinality; handle both.
    const themesRaw = raw['themes'] as
      | { hero_image_url?: string | null }
      | Array<{ hero_image_url?: string | null }>
      | null
      | undefined;
    const theme = Array.isArray(themesRaw) ? (themesRaw[0] ?? null) : (themesRaw ?? null);
    return {
      id: String(raw['id'] ?? ''),
      name: String(raw['name'] ?? ''),
      city: typeof raw['city'] === 'string' ? raw['city'] : null,
      country: typeof raw['country'] === 'string' ? raw['country'] : null,
      startDate: String(raw['start_date'] ?? raw['startDate'] ?? ''),
      endDate: String(raw['end_date'] ?? raw['endDate'] ?? ''),
      publicLandingMd:
        typeof (raw['public_landing_md'] ?? raw['publicLandingMd']) === 'string'
          ? String(raw['public_landing_md'] ?? raw['publicLandingMd'])
          : null,
      status: String(raw['status'] ?? ''),
      timezone: typeof raw['timezone'] === 'string' ? raw['timezone'] : 'Europe/Paris',
      logoUrl:
        typeof (raw['logo_url'] ?? raw['logoUrl']) === 'string'
          ? String(raw['logo_url'] ?? raw['logoUrl'])
          : null,
      heroImageUrl: typeof theme?.hero_image_url === 'string' ? theme.hero_image_url : null,
      organizationName: typeof org?.name === 'string' ? org.name : null,
      organizationLogoUrl: typeof org?.logo_url === 'string' ? org.logo_url : null,
    };
  } catch {
    return null;
  }
}

export function EventHeader({ event, locale }: { event: EventInfo; locale: Locale }) {
  // Pure translator from the passed locale — EventHeader renders in both server
  // (event pages) and client (workshop detail) contexts, so it can use neither
  // the async server `t` nor the useI18n() hook.
  const t = createTranslator(getMessages(locale));
  const place = formatEventPlace(event, locale);
  return (
    <>
      {event.heroImageUrl && (
        <section
          aria-label={t('publicApp.eventHome.eventHero')}
          className="relative -mx-4 aspect-[16/7] max-h-[200px] overflow-hidden rounded-none sm:aspect-[9/2] sm:rounded-xl"
        >
          {/* Decorative banner — the event name is in the H1 below, so alt="" is correct. */}
          <img src={event.heroImageUrl} alt="" className="h-full w-full object-cover" />
        </section>
      )}

      <section className="flex flex-col gap-4 border-y border-border py-6 sm:flex-row sm:items-start sm:justify-between sm:py-8">
        <div className="flex min-w-0 items-start gap-3">
          {event.organizationLogoUrl && (
            <img
              src={event.organizationLogoUrl}
              alt=""
              className="h-14 w-14 shrink-0 rounded-lg border border-border bg-surface object-contain"
            />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="mb-1 font-display text-3xl font-bold text-foreground sm:text-4xl">
              {event.name}
            </h1>
            {event.organizationName && (
              <p className="text-sm font-semibold text-foreground-secondary">
                {event.organizationName}
              </p>
            )}
            {place ? <p className="text-sm text-muted">{place}</p> : null}
            <p className="mt-0.5 text-sm text-muted">
              {formatDateRange(event.startDate, event.endDate, locale)}
            </p>

            {event.status === 'running' && (
              <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-success/60 bg-success/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success motion-safe:animate-pulse" />
                {t('publicApp.eventHome.liveNow')}
              </span>
            )}

            {event.publicLandingMd && (
              <div className="prose prose-sm mt-4 max-w-none whitespace-pre-line text-sm leading-relaxed text-foreground-secondary">
                {event.publicLandingMd}
              </div>
            )}
          </div>
        </div>

        {event.logoUrl && (
          <img
            src={event.logoUrl}
            alt=""
            className="h-20 w-20 shrink-0 rounded-xl border border-border bg-surface object-cover sm:ml-4"
          />
        )}
      </section>
    </>
  );
}
