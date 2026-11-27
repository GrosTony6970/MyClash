'use client';

import { usePathname } from 'next/navigation';
import { InstallAppButton, LegalFooter } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { isDisplayRoute } from '../lib/display-routes';
import { getLegalUrl } from '../lib/legal-url';

/**
 * The routes whose shell has a sidebar: `PublicPersonalShell` (`/me`). It
 * renders the links under Log out, so the page footer stays away. A new
 * sidebar shell must add its route here, or its pages show the links twice.
 */
const SIDEBAR_SHELL_ROUTES = [/^\/me(?:\/|$)/];

export function hasSidebarShell(path: string | null): boolean {
  return path !== null && SIDEBAR_SHELL_ROUTES.some((route) => route.test(path));
}

/**
 * The terms + privacy links.
 *
 * `page`: the slim line the root layout draws under every route without a
 * sidebar, with "Install the app" above it while the browser offers it. Not on
 * the projector surfaces: a display is output, nobody touches it, and a footer
 * of links across a hall screen is chrome on a surface defined by having none.
 * The route list is shared with `MaybeSiteHeader` (`isDisplayRoute`).
 *
 * `sidebar`: the copy a shell draws under its Log out button.
 */
export function AppLegalFooter({
  placement,
}: {
  placement: 'page' | 'sidebar';
}): React.ReactElement | null {
  const path = usePathname();
  const { t, locale } = useI18n();

  if (placement === 'page' && (isDisplayRoute(path) || hasSidebarShell(path))) return null;

  return (
    <LegalFooter
      variant={placement}
      links={[
        { label: t('legal.terms'), href: getLegalUrl('terms', locale) },
        { label: t('legal.privacy'), href: getLegalUrl('privacy', locale) },
      ]}
      note={t('legal.footerNote')}
      action={
        placement === 'page' ? (
          <InstallAppButton label={t('common.installApp')} className="mb-2" />
        ) : undefined
      }
    />
  );
}
