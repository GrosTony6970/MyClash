/**
 * Display hub — route: /e/[eventSlug]/display
 *
 * The one URL an organizer can hand to whoever runs the screens. It answers the
 * three questions the per-lice display URLs never did: *what* is being fought
 * right now, *which* Lice am I putting on this screen, and *where* do I sign in
 * to actually score.
 *
 * The picker is grouped by venue and area, because a tournament can run in
 * parallel across several halls and an operator standing in one of them should
 * not have to guess which pistes are in front of them.
 *
 * Not a kiosk surface itself (a pointer exists here), so it keeps the site
 * chrome — unlike the `/lice/[liceName]/display` routes it links to.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BackLink } from '@/components/BackLink';
import { getServerApiUrl } from '@/lib/api-url';
import { getServerT } from '@myclash/next-i18n/server';
import { getStaffLoginUrl } from '@/lib/staff-url';
import { NowLiveSection } from './NowLiveSection';
import {
  groupLicesByPlacement,
  mapHubLice,
  placementLabel,
  type HubLice,
  type LiceGroup,
} from '@myclash/types';

interface Props {
  params: Promise<{ eventSlug: string }>;
}

interface EventDisplays {
  name: string;
  lices: HubLice[];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { eventSlug } = await params;
  const t = await getServerT();
  return { title: `${t('publicApp.display.hubTitle')} — ${eventSlug}` };
}

/**
 * One public call: `GET /events/:slug` already embeds
 * `lices(*, venues(id, name), venue_areas(id, name))`, so the hub needs no
 * endpoint of its own. Test-kind events 404 there, and so here.
 */
async function fetchDisplays(eventSlug: string, apiUrl: string): Promise<EventDisplays | null> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/events/${encodeURIComponent(eventSlug)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as Record<string, unknown>;
    const rows = Array.isArray(raw['lices'])
      ? (raw['lices'] as Array<Record<string, unknown>>)
      : [];
    const lices = rows.map(mapHubLice).filter((lice): lice is HubLice => lice !== null);
    return { name: String(raw['name'] ?? eventSlug), lices };
  } catch {
    return null;
  }
}

function LiceCard({ eventSlug, lice, label }: { eventSlug: string; lice: HubLice; label: string }) {
  return (
    <li>
      <Link
        href={`/e/${eventSlug}/lice/${encodeURIComponent(lice.name)}/display`}
        className="flex h-full flex-col rounded-lg border border-border bg-surface p-4 transition hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
      >
        <span className="font-display text-lg font-bold">{lice.name}</span>
        <span className="mt-2 text-sm font-semibold text-accent">{label} →</span>
      </Link>
    </li>
  );
}

export default async function DisplayHubPage({ params }: Props) {
  const { eventSlug } = await params;
  const t = await getServerT();
  const displays = await fetchDisplays(eventSlug, getServerApiUrl());
  if (!displays) notFound();

  const groups: LiceGroup[] = groupLicesByPlacement(displays.lices);
  // A single-hall event is the common case and it looked fine as a flat grid;
  // headings only earn their space once the pistes are actually split up.
  const showHeadings = groups.length > 1;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6">
      <BackLink
        href={`/e/${eventSlug}/home`}
        label={t('publicApp.eventHome.backToHome')}
        className="mb-4"
      />
      <h1 className="font-display text-2xl font-bold sm:text-3xl">
        {t('publicApp.display.hubTitle')}
      </h1>
      <p className="mt-1 text-sm text-muted">{displays.name}</p>
      <p className="mt-2 text-sm text-foreground-secondary">
        {t('publicApp.display.hubDescription')}
      </p>

      <NowLiveSection eventSlug={eventSlug} lices={displays.lices} />

      <section className="mt-6 rounded-lg border border-border bg-surface p-4">
        <h2 className="font-display text-lg font-semibold">{t('publicApp.display.staffSignIn')}</h2>
        <p className="mt-1 text-sm text-muted">{t('publicApp.display.staffSignInHelp')}</p>
        <a
          href={getStaffLoginUrl(eventSlug)}
          className="mt-3 inline-block rounded-md bg-accent px-4 py-2 text-sm font-bold text-accent-foreground transition hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent"
        >
          {t('publicApp.display.staffSignIn')}
        </a>
      </section>

      <h2 className="mt-8 font-display text-lg font-semibold">
        {t('publicApp.display.chooseLice')}
      </h2>
      {groups.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-border p-6 text-sm text-muted">
          {t('publicApp.display.noLices')}
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="mt-4">
            {showHeadings && (
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                {placementLabel(group.venueName, group.areaName) ?? t('publicApp.display.noVenue')}
              </h3>
            )}
            <ul className="mt-2 grid gap-3 sm:grid-cols-2">
              {group.lices.map((lice) => (
                <LiceCard
                  key={lice.id}
                  eventSlug={eventSlug}
                  lice={lice}
                  label={t('publicApp.display.openDisplay')}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
