'use client';

import { usePathname } from 'next/navigation';
import { isDisplayRoute } from '../../src/lib/display-routes';
import { SiteHeader } from './SiteHeader';

/**
 * Renders the public app's <SiteHeader /> on every route EXCEPT the
 * TV / projection displays (`isDisplayRoute` — the per-match and the
 * per-lice one).
 *
 * A display is rendered fullscreen in a kiosk browser; a navigation bar
 * would be wasted real estate and visually broken on a projector. It
 * also put a spectator "Sign in" button on the screen an event's staff
 * are handed — the wrong door, since a referee's PIN only works on the
 * scoring pad. The staff sign-in lives on the display hub
 * (/e/[eventSlug]/display) and in the kiosk's own control layer.
 */
export function MaybeSiteHeader(): React.ReactElement | null {
  const path = usePathname();
  if (isDisplayRoute(path)) return null;
  return <SiteHeader />;
}
