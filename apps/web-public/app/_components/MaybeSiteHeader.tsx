'use client';

import { usePathname } from 'next/navigation';
import { SiteHeader } from './SiteHeader';

/**
 * Renders the public app's <SiteHeader /> on every route EXCEPT the
 * TV / projection display at /e/[eventSlug]/match/[matchId]/display.
 *
 * The TV display is rendered fullscreen in a kiosk browser; a left
 * navigation bar would be wasted real estate and visually broken on
 * a projector. Other public routes (event pages, leagues, home) keep
 * the SiteHeader unchanged.
 */
const DISPLAY_ROUTE = /^\/e\/[^/]+\/match\/[^/]+\/display\/?$/;

export function MaybeSiteHeader(): React.ReactElement | null {
  const path = usePathname();
  if (path && DISPLAY_ROUTE.test(path)) return null;
  return <SiteHeader />;
}
