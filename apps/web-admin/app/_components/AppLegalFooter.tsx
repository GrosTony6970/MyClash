'use client';

import { usePathname } from 'next/navigation';
import { LegalFooter } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { getLegalUrl } from '../../src/lib/legal-url';

/**
 * The terms + privacy links, on every admin route except the projector.
 *
 * `/display/[matchId]` is the hall screen and `/display/wall/[eventId]` is the
 * control-room wall — both chromeless by definition (see
 * `docs/design/display-kiosk.md`), so neither takes a footer.
 *
 * Kept narrow rather than a blanket `^/display/` prefix: a prefix would
 * silently strip the footer off any future page that happens to live under
 * /display but is not a hall screen. A new projector surface should have to
 * name itself here.
 */
const DISPLAY_ROUTE = /^\/display\/(?:wall\/)?[^/]+\/?$/;

export function AppLegalFooter(): React.ReactElement | null {
  const path = usePathname();
  const { t, locale } = useI18n();

  if (path && DISPLAY_ROUTE.test(path)) return null;

  return (
    <LegalFooter
      links={[
        { label: t('legal.terms'), href: getLegalUrl('terms', locale) },
        { label: t('legal.privacy'), href: getLegalUrl('privacy', locale) },
      ]}
      note={t('legal.footerNote')}
    />
  );
}
