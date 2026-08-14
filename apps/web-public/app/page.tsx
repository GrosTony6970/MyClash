import type { Metadata } from 'next';
import { PublicEventsBrowser } from './_components/PublicEventsBrowser';
import { parseEventFilters, parseTab } from './_components/event-filters';
import { getServerT } from '@myclash/next-i18n/server';

// Next.js 16 defaults route segments to static rendering. The public
// landing page must always reflect the current published-events list
// (operators publish on the admin and expect their event to appear
// here within seconds), so we force fresh SSR on every request. The
// `cache: 'no-store'` on the fetch inside PublicEventsBrowser covers
// the data layer; these exports cover the route-segment layer.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * The catalogue's own metadata. The root layout's title is the app name, which
 * says nothing about this page; a search result for the catalogue should say
 * what the catalogue is.
 *
 * The canonical is bare `/` on purpose: the filters and the tab are all
 * query params, so a filtered view is the same page. Letting each combination
 * self-canonicalise would split the catalogue's ranking across every search
 * anyone has ever linked.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return {
    title: t('publicApp.home.title'),
    description: t('publicApp.home.subtitle'),
    alternates: { canonical: '/' },
    openGraph: {
      title: t('publicApp.home.title'),
      description: t('publicApp.home.subtitle'),
      url: '/',
      type: 'website',
    },
  };
}

export default async function HomePage({
  searchParams,
}: {
  // Next 15/16 hands searchParams in as a Promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getServerT();
  const params = await searchParams;
  // Parsed here, not in the client bar: validation lives on the way IN, so a
  // hand-edited or link-rotted URL can never forward junk to the API.
  const filters = parseEventFilters(params);
  // Read on the server so a link to a tab opens on that tab, server-rendered.
  const tab = parseTab(params['tab']);
  return (
    <main
      id="main-content"
      className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <section className="border-y border-border py-5">
          {/* The page's only h1. The heading used to be a <p>, which left the
              document with no h1 at all — the brand in SiteHeader is a <span>
              and every section below is an h2. */}
          <h1 className="max-w-2xl font-display font-bold text-2xl sm:text-3xl text-foreground">
            {t('publicApp.home.title')}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-secondary">
            {t('publicApp.home.subtitle')}
          </p>
        </section>

        <PublicEventsBrowser filters={filters} tab={tab} />
      </div>
    </main>
  );
}
