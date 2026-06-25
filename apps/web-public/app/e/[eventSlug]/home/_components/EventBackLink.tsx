import { t } from '@myclash/i18n';
import { BackLink } from '@/components/BackLink';

/**
 * "← Back to events" link rendered at the top of each event-home
 * persona variant. The SiteHeader already covers the global nav,
 * but it doesn't surface a per-page back affordance — operators on
 * phones report tapping the address bar instead of finding the
 * logo. This in-page link removes that friction.
 *
 * Delegates to the shared {@link BackLink} so the back affordance
 * matches every other public event page (tournament, workshops, …).
 */
export function EventBackLink() {
  return <BackLink href="/" label={t('publicApp.eventHome.backToEvents')} />;
}
