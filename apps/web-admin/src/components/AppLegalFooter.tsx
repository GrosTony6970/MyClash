'use client';

import { usePathname } from 'next/navigation';
import { LegalFooter } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { getLegalUrl } from '../lib/legal-url';

/**
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

/**
 * The routes whose shell has a sidebar: `SuperAdminShell` (`/admin`) and
 * `OrganizerAdminShell` (`/org/[slug]`). Those shells render the links under
 * Log out, so the page footer stays away. A new sidebar shell must add its
 * route here, or its pages show the links twice.
 */
const SIDEBAR_SHELL_ROUTES = [/^\/admin(?:\/|$)/, /^\/org\/[^/]+(?:\/|$)/];

export function hasSidebarShell(path: string | null): boolean {
  return path !== null && SIDEBAR_SHELL_ROUTES.some((route) => route.test(path));
}

/**
 * The terms + privacy links. `page`: the slim line the root layout draws under
 * every route without a sidebar (and not on the projector). `sidebar`: the copy
 * a shell draws under its Log out button.
 */
export function AppLegalFooter({
  placement,
}: {
  placement: 'page' | 'sidebar';
}): React.ReactElement | null {
  const path = usePathname();
  const { t, locale } = useI18n();

  if (placement === 'page' && path && (DISPLAY_ROUTE.test(path) || hasSidebarShell(path))) {
    return null;
  }

  return (
    <LegalFooter
      variant={placement}
      links={[
        { label: t('legal.terms'), href: getLegalUrl('terms', locale) },
        { label: t('legal.privacy'), href: getLegalUrl('privacy', locale) },
      ]}
      note={t('legal.footerNote')}
    />
  );
}
