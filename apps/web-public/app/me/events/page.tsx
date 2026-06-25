import { t } from '@myclash/i18n';
import { PublicEventsBrowser } from '../../_components/PublicEventsBrowser';

// Always reflect the current published-events list (same as the public
// landing page); the data fetch inside PublicEventsBrowser is no-store.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Personal-space "Public events" tab. Renders the same published-events
 * listing as the landing page, but inside the personal shell (left nav stays
 * put) instead of bouncing the user out to the marketing home.
 */
export default function PersonalSpaceEventsPage() {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section>
          <p className="font-display text-2xl font-semibold text-slate-900">
            {t('publicApp.personalShell.nav.events')}
          </p>
        </section>
        <PublicEventsBrowser />
      </div>
    </div>
  );
}
