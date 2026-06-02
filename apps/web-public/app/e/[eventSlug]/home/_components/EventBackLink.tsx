import Link from 'next/link';
import { t } from '@myclash/i18n';

/**
 * "← Back to events" link rendered at the top of each event-home
 * persona variant. The SiteHeader already covers the global nav,
 * but it doesn't surface a per-page back affordance — operators on
 * phones report tapping the address bar instead of finding the
 * logo. This in-page link removes that friction.
 *
 * Palette matches the unified MyClash design (red accent on the light
 * stone surface, mirroring the organizer admin).
 */
export function EventBackLink() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold text-red-700 hover:text-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
    >
      <span aria-hidden="true">←</span>
      <span>{t('publicApp.eventHome.backToEvents')}</span>
    </Link>
  );
}
