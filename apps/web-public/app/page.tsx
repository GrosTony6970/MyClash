import { t } from '@myclash/i18n';
import { PublicEventsBrowser } from './_components/PublicEventsBrowser';

// Next.js 16 defaults route segments to static rendering. The public
// landing page must always reflect the current published-events list
// (operators publish on the admin and expect their event to appear
// here within seconds), so we force fresh SSR on every request. The
// `cache: 'no-store'` on the fetch inside PublicEventsBrowser covers
// the data layer; these exports cover the route-segment layer.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function HomePage() {
  return (
    <main
      id="main-content"
      className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <section className="border-y border-border py-5">
          <p className="max-w-2xl font-display font-bold text-2xl sm:text-3xl text-foreground">
            {t('publicApp.home.title')}
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-secondary">
            {t('publicApp.home.subtitle')}
          </p>
        </section>

        <PublicEventsBrowser />
      </div>
    </main>
  );
}
