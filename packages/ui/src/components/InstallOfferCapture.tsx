import { INSTALL_CAPTURE_SCRIPT } from '../hooks/install-offer';

/**
 * The inline script that keeps the browser's install offer before React runs
 * (`install-offer.ts` says why it cannot wait). Rendered once, in a root layout.
 * A fixed string of our own: nothing from a request goes into it.
 */
export function InstallOfferCapture() {
  return <script dangerouslySetInnerHTML={{ __html: INSTALL_CAPTURE_SCRIPT }} />;
}
