'use client';

import { usePathname } from 'next/navigation';
import { LegalFooter } from '@myclash/ui';
import { useI18n } from '../../src/i18n/I18nProvider';
import { getLegalUrl } from '../../src/lib/legal-url';

/**
 * The terms + privacy links, on every route except the projector surfaces.
 *
 * A display is output: nobody touches it, and a footer of links across the
 * bottom of a hall screen is chrome on a surface that is defined by having
 * none. Both display routes are matched here — `MaybeSiteHeader` only strips
 * the match one, which is why this keeps its own pattern rather than importing
 * that component's.
 */
const DISPLAY_ROUTES = [
  /^\/e\/[^/]+\/match\/[^/]+\/display\/?$/,
  /^\/e\/[^/]+\/lice\/[^/]+\/display\/?$/,
];

export function AppLegalFooter(): React.ReactElement | null {
  const path = usePathname();
  const { t, locale } = useI18n();

  if (path && DISPLAY_ROUTES.some((route) => route.test(path))) return null;

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
