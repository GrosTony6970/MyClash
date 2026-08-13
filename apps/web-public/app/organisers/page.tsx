/**
 * Public organiser directory.
 * Route: /organisers
 *
 * The browsable half of "follow an organiser": the Follow button lives on
 * /o/[slug] and in the event header, but until this page existed there was no
 * way to reach an organiser you did not already follow — the Organisers tab of
 * /me/follows only lists the ones you have.
 *
 * Server component reading `searchParams`, same shape as the landing page, so a
 * filtered directory is a shareable link and stays indexable. The only per-user
 * bit is the follow button on each card.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@myclash/ui';
import type { TranslationValues } from '@myclash/i18n';
import { getServerApiUrl } from '@/lib/api-url';
import { getServerT } from '@myclash/next-i18n/server';
import { FollowOrganizerButton } from '../_components/FollowOrganizerButton';
import { OrganiserSearchBar } from './OrganiserSearchBar';

interface PublicOrganizer {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  brandColor: string | null;
  followerCount: number;
  upcomingEventCount: number;
}

interface OrganizerPage {
  items: PublicOrganizer[];
  total: number;
}

const PAGE_SIZE = 24;

async function fetchOrganizers(
  q: string,
  offset: number,
  apiUrl: string,
): Promise<OrganizerPage | null> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (q) params.set('q', q);
  try {
    const res = await fetch(`${apiUrl}/api/v1/organizations/public?${params.toString()}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as OrganizerPage;
  } catch {
    return null;
  }
}

/** Same shield fallback the Organisers tab of /me/follows uses. */
function OrganiserLogo({ url }: { url: string | null }) {
  if (!url) {
    return (
      <span
        aria-hidden="true"
        className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg border border-border text-xl"
      >
        🛡️
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      className="h-12 w-12 flex-shrink-0 rounded-lg border border-border object-contain p-0.5"
    />
  );
}

/**
 * One organiser. Deliberately NOT wrapped in an anchor: it holds a follow
 * button, and a button inside a link is the same invalid nesting that stops the
 * landing-page event cards from linking to an organiser at all.
 */
function OrganiserCard({
  org,
  t,
}: {
  org: PublicOrganizer;
  t: (key: string, values?: TranslationValues) => string;
}) {
  return (
    <li
      style={{ borderLeftColor: org.brandColor ?? undefined }}
      className={`flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm ${
        org.brandColor ? 'border-l-4' : ''
      }`}
    >
      <div className="flex items-center gap-3">
        <OrganiserLogo url={org.logoUrl} />
        <div className="min-w-0 flex-1">
          <Link
            href={`/o/${org.slug}`}
            className="block truncate font-semibold text-foreground hover:text-accent hover:underline"
          >
            {org.name}
          </Link>
          <p className="mt-0.5 text-xs text-muted">
            {org.upcomingEventCount > 0
              ? t('publicApp.organisers.upcomingCount', { count: org.upcomingEventCount })
              : t('publicApp.organisers.noUpcoming')}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted">
          {t('publicApp.organizer.followerCount', { count: org.followerCount })}
        </span>
        <FollowOrganizerButton organizationId={org.id} slug={org.slug} />
      </div>
    </li>
  );
}

/** Single string out of a searchParams entry that may arrive as an array. */
function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

// Organisers are approved on the admin side and expect to appear here without
// waiting for a revalidation window — same reasoning as /o/[slug].
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return {
    title: t('publicApp.organisers.metaTitle'),
    description: t('publicApp.organisers.metaDescription'),
  };
}

export default async function OrganisersPage({
  searchParams,
}: {
  // Next 15/16 hands searchParams in as a Promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getServerT();
  const params = await searchParams;
  const q = first(params['q']).trim().slice(0, 100);
  // Clamped on the way IN, so a hand-edited URL can never forward junk to the
  // API (a negative offset would 400 the whole page).
  const parsedOffset = Number.parseInt(first(params['offset']), 10);
  const offset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0;

  const page = await fetchOrganizers(q, offset, getServerApiUrl());

  return (
    <main id="main-content" className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 border-b border-border pb-5">
        <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
          {t('publicApp.organisers.title')}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-secondary">
          {t('publicApp.organisers.subtitle')}
        </p>
      </header>

      {page === null ? (
        <EmptyState title={t('publicApp.organisers.loadError')} />
      ) : (
        <>
          <div className="mb-6">
            <OrganiserSearchBar q={q} resultCount={page.total} />
          </div>

          {page.items.length === 0 ? (
            <EmptyState
              title={
                q
                  ? t('publicApp.organisers.emptyForQuery', { query: q })
                  : t('publicApp.organisers.empty')
              }
            />
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {page.items.map((org) => (
                <OrganiserCard key={org.id} org={org} t={t} />
              ))}
            </ul>
          )}

          <Pager q={q} offset={offset} shown={page.items.length} total={page.total} t={t} />
        </>
      )}
    </main>
  );
}

/**
 * Offset pager as plain links: server-rendered, shareable, and it works with
 * JavaScript off. `q` rides along so paging does not silently drop the search.
 */
function Pager({
  q,
  offset,
  shown,
  total,
  t,
}: {
  q: string;
  offset: number;
  shown: number;
  total: number;
  t: (key: string, values?: TranslationValues) => string;
}) {
  const hasPrevious = offset > 0;
  const hasNext = offset + shown < total;
  if (!hasPrevious && !hasNext) return null;

  function href(nextOffset: number): string {
    const search = new URLSearchParams();
    if (q) search.set('q', q);
    if (nextOffset > 0) search.set('offset', String(nextOffset));
    const qs = search.toString();
    return qs ? `/organisers?${qs}` : '/organisers';
  }

  const linkClass =
    'rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:border-accent/60 hover:bg-accent/10';

  return (
    <nav className="mt-6 flex items-center justify-between gap-3">
      {hasPrevious ? (
        <Link href={href(Math.max(0, offset - PAGE_SIZE))} className={linkClass}>
          {t('publicApp.organisers.previous')}
        </Link>
      ) : (
        <span />
      )}
      {hasNext && (
        <Link href={href(offset + PAGE_SIZE)} className={linkClass}>
          {t('publicApp.organisers.next')}
        </Link>
      )}
    </nav>
  );
}
