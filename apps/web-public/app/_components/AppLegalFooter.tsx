'use client';

import { usePathname } from 'next/navigation';
import { LegalFooter } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { isDisplayRoute } from '../../src/lib/display-routes';
import { getLegalUrl } from '../../src/lib/legal-url';

/**
 * The terms + privacy links, on every route except the projector surfaces.
 *
 * A display is output: nobody touches it, and a footer of links across the
 * bottom of a hall screen is chrome on a surface that is defined by having
 * none. The route list is shared with `MaybeSiteHeader` (`isDisplayRoute`) —
 * the two used to disagree about the per-lice route.
 */
export function AppLegalFooter(): React.ReactElement | null {
  const path = usePathname();
  const { t, locale } = useI18n();

  if (isDisplayRoute(path)) return null;

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
