/**
 * Display hub — route: /e/[eventSlug]/display
 *
 * The one URL an organizer can hand to whoever runs the screens. It answers the
 * two questions the per-lice display URLs never did: *which* Lice am I putting
 * on this screen, and *where* do I sign in to actually score.
 *
 * Not a kiosk surface itself (a pointer exists here), so it keeps the site
 * chrome — unlike the `/lice/[liceName]/display` routes it links to.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BackLink } from '@/components/BackLink';
import { getServerApiUrl } from '@/lib/api-url';
import { getServerT } from '@/i18n/server-locale';
import { getStaffLoginUrl } from '@/lib/scoring-url';

interface Props {
  params: Promise<{ eventSlug: string }>;
}

interface LiceRow {
  id: string;
  name: string;
  locationLabel: string | null;
  sortOrder: number;
}

interface EventDisplays {
  name: string;
  lices: LiceRow[];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { eventSlug } = await params;
  const t = await getServerT();
  return { title: `${t('publicApp.display.hubTitle')} — ${eventSlug}` };
}

/**
 * One public call: `GET /events/:slug` already embeds `lices(*)`, so the hub
 * needs no endpoint of its own. Test-kind events 404 there, and so here.
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
    const lices = rows
      .map((row) => ({
        id: String(row['id'] ?? ''),
        name: String(row['name'] ?? ''),
        locationLabel:
          typeof row['location_label'] === 'string' && row['location_label'].trim().length > 0
            ? row['location_label']
            : null,
        sortOrder: typeof row['sort_order'] === 'number' ? row['sort_order'] : 0,
      }))
      .filter((lice) => lice.id.length > 0 && lice.name.length > 0)
      // The embed carries no ordering of its own; the admin's column order is
      // sort_order, and names break the ties.
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    return { name: String(raw['name'] ?? eventSlug), lices };
  } catch {
    return null;
  }
}

export default async function DisplayHubPage({ params }: Props) {
  const { eventSlug } = await params;
  const t = await getServerT();
  const displays = await fetchDisplays(eventSlug, getServerApiUrl());
  if (!displays) notFound();

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
      {displays.lices.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-border p-6 text-sm text-muted">
          {t('publicApp.display.noLices')}
        </p>
      ) : (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {displays.lices.map((lice) => (
            <li key={lice.id}>
              <Link
                href={`/e/${eventSlug}/lice/${encodeURIComponent(lice.name)}/display`}
                className="flex h-full flex-col rounded-lg border border-border bg-surface p-4 transition hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <span className="font-display text-lg font-bold">{lice.name}</span>
                {lice.locationLabel && (
                  <span className="mt-0.5 text-sm text-muted">{lice.locationLabel}</span>
                )}
                <span className="mt-2 text-sm font-semibold text-accent">
                  {t('publicApp.display.openDisplay')} →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
