/**
 * /fighters — the public fighter directory.
 *
 * A server component on the /organisers skeleton: clamped searchParams, `null`
 * as the load-error sentinel distinct from "no results", an EmptyState for
 * each, and a link Pager. Filters and sorting all live in the URL, so a filtered
 * directory is shareable, server-rendered and indexable.
 *
 * Who appears here is decided in one place and not by this page: the
 * `search_public_fighters` RPC bakes in the directory predicate (0188), which is
 * the same rule as `isListed()` and as the RLS policy in 0187. A page that
 * filtered for itself would be a fourth place for somebody's opt-out to fail.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@myclash/ui';
import type { TranslationValues } from '@myclash/i18n';
import { getServerT } from '@myclash/next-i18n/server';
import { getServerApiUrl } from '@/lib/api-url';
import { FighterDirectoryFilters, type WeaponOption } from './FighterDirectoryFilters';
import { FighterDirectoryTable } from './FighterDirectoryTable';
import {
  PAGE_SIZE,
  directoryHref,
  hasAnyDirectoryFilter,
  parseDirectoryFilters,
  toDirectoryQueryString,
  type DirectoryFilters,
} from './directory-filters';
import type { DirectoryApiFighter } from './fighter-row-model';

interface DirectoryPage {
  items: DirectoryApiFighter[];
  total: number;
}

/** `null` means the API could not be reached — distinct from an empty page. */
async function fetchDirectory(
  filters: DirectoryFilters,
  apiUrl: string,
): Promise<DirectoryPage | null> {
  const params = new URLSearchParams(toDirectoryQueryString(filters));
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String(filters.offset));
  try {
    const res = await fetch(`${apiUrl}/api/v1/fighters/public?${params.toString()}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as DirectoryPage;
  } catch {
    return null;
  }
}

/** Soft-fails: losing the catalogue costs one filter, not the whole page. */
async function fetchWeapons(apiUrl: string): Promise<WeaponOption[]> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/weapons?active=true`, { cache: 'no-store' });
    if (!res.ok) return [];
    return (await res.json()) as WeaponOption[];
  } catch {
    return [];
  }
}

// Fighters opt in and out from their own profile and expect the change to show
// without waiting for a revalidation window — same reasoning as /organisers.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return {
    title: t('publicApp.fighters.metaTitle'),
    description: t('publicApp.fighters.metaDescription'),
    // Bare `/fighters`: the filters and sort are query params, so every
    // combination is the same page. Letting each self-canonicalise would split
    // the directory's ranking across every search anyone has ever linked.
    alternates: { canonical: '/fighters' },
  };
}

export default async function FightersPage({
  searchParams,
}: {
  // Next 15/16 hands searchParams in as a Promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getServerT();
  // Parsed here, not in the client bar: validation lives on the way IN, so a
  // hand-edited or link-rotted URL can never forward junk to the API.
  const filters = parseDirectoryFilters(await searchParams);
  const apiUrl = getServerApiUrl();

  const [page, weapons] = await Promise.all([
    fetchDirectory(filters, apiUrl),
    fetchWeapons(apiUrl),
  ]);

  return (
    <main id="main-content" className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 border-b border-border pb-5">
        <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
          {t('publicApp.fighters.title')}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-secondary">
          {t('publicApp.fighters.subtitle')}
        </p>
      </header>

      {page === null ? (
        <EmptyState title={t('publicApp.fighters.loadError')} />
      ) : (
        <>
          <div className="mb-6">
            <FighterDirectoryFilters filters={filters} weapons={weapons} resultCount={page.total} />
          </div>

          {page.items.length === 0 ? (
            <EmptyState
              title={
                hasAnyDirectoryFilter(filters)
                  ? t('publicApp.fighters.emptyForQuery')
                  : t('publicApp.fighters.empty')
              }
              description={
                hasAnyDirectoryFilter(filters) ? undefined : t('publicApp.fighters.emptyHint')
              }
            />
          ) : (
            <FighterDirectoryTable fighters={page.items} filters={filters} />
          )}

          <Pager filters={filters} shown={page.items.length} total={page.total} t={t} />
        </>
      )}
    </main>
  );
}

/**
 * Offset pager as plain links: server-rendered, shareable, and it works with
 * JavaScript off. The filters ride along so paging never silently drops them.
 */
function Pager({
  filters,
  shown,
  total,
  t,
}: {
  filters: DirectoryFilters;
  shown: number;
  total: number;
  t: (key: string, values?: TranslationValues) => string;
}) {
  const hasPrevious = filters.offset > 0;
  const hasNext = filters.offset + shown < total;
  if (!hasPrevious && !hasNext) return null;

  const linkClass =
    'rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:border-accent/60 hover:bg-accent/10';

  return (
    <nav className="mt-6 flex items-center justify-between gap-3">
      {hasPrevious ? (
        <Link
          href={directoryHref({ ...filters, offset: Math.max(0, filters.offset - PAGE_SIZE) })}
          className={linkClass}
        >
          {t('publicApp.fighters.previous')}
        </Link>
      ) : (
        <span />
      )}
      {hasNext && (
        <Link
          href={directoryHref({ ...filters, offset: filters.offset + PAGE_SIZE })}
          className={linkClass}
        >
          {t('publicApp.fighters.next')}
        </Link>
      )}
    </nav>
  );
}
