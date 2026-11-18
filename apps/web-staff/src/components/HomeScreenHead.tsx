import { InstallOfferCapture } from '@myclash/ui';
import { ManifestLink } from './ManifestLink';

/**
 * What the browser reads to put the pad on a home screen: the icon iOS uses,
 * the manifest Android installs from (staff site only, `ManifestLink`), and the
 * capture that keeps Chrome's install offer for the sign-in screen's button.
 * Rendered in the root layout's `<head>`.
 */
export function HomeScreenHead() {
  return (
    <>
      <link rel="apple-touch-icon" href="/brand/Logomini_nobackground.png" />
      <meta name="mobile-web-app-capable" content="yes" />
      <InstallOfferCapture />
      <ManifestLink />
    </>
  );
}
