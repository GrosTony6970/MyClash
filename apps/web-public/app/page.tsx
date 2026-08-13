import { PublicEventsBrowser } from './_components/PublicEventsBrowser';
import { parseEventFilters } from './_components/event-filters';
import { getServerT } from '@myclash/next-i18n/server';

// Next.js 16 defaults route segments to static rendering. The public
// landing page must always reflect the current published-events list
// (operators publish on the admin and expect their event to appear
// here within seconds), so we force fresh SSR on every request. The
// `cache: 'no-store'` on the fetch inside PublicEventsBrowser covers
// the data layer; these exports cover the route-segment layer.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function HomePage({
  searchParams,
}: {
  // Next 15/16 hands searchParams in as a Promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getServerT();
  // Parsed here, not in the client bar: validation lives on the way IN, so a
  // hand-edited or link-rotted URL can never forward junk to the API.
  const filters = parseEventFilters(await searchParams);
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

        <PublicEventsBrowser filters={filters} />
      </div>
    </main>
  );
}
