'use client';

import { usePathname } from 'next/navigation';
import { LegalFooter } from '@myclash/ui';
import { useI18n } from '../../src/i18n/I18nProvider';
import { getLegalUrl } from '../../src/lib/legal-url';

/**
 * The terms + privacy links, on every admin route except the projector.
 *
 * `/display/[matchId]` is the hall screen — chromeless by definition (see
 * `docs/design/display-kiosk.md`), so it takes no footer.
 */
const DISPLAY_ROUTE = /^\/display\/[^/]+\/?$/;

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
