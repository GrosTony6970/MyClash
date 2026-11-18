/**
 * The browser's offer to install the app on the home screen, kept until a
 * button asks for it.
 *
 * Chrome on Android says an app can be installed with ONE event,
 * `beforeinstallprompt`, sent soon after the page loads. A listener that React
 * adds after hydration can arrive after it, and the offer is lost until the
 * next visit. So an inline script (`INSTALL_CAPTURE_SCRIPT`, rendered by
 * `InstallOfferCapture` in each root layout) catches the event before React
 * runs, and keeps it on `window`. `InstallAppButton` reads what was kept.
 *
 * The capture calls `preventDefault()`: Chrome then shows none of its own
 * install bars. The app's button is the only ask, so no bar of Chrome's covers
 * the scoring pad mid-bout. Chrome's menu still offers to install.
 *
 * Safari sends no such event: on an iPhone the button never shows.
 */

/** Chrome's event. Not in the DOM typings: it is not a web standard. */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
}

/** Where the offer is kept, and the events it is told by. A `window`, or a test's double. */
export interface InstallHost extends EventTarget {
  __myclashInstallOffer?: InstallPromptEvent | null;
}

/** Sent on the host each time the kept offer changes. */
const CHANGED = 'myclash:install-offer';

/**
 * Keeps the browser's offer, and drops it once the app is installed.
 *
 * Written out as the text of an inline script, so it uses nothing from outside
 * its own body: the key and the event name are written here as literals, in
 * step with `CHANGED` and `InstallHost` above (the tests hold that).
 */
export function captureInstallOffer(host: InstallHost): void {
  host.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    host.__myclashInstallOffer = event as InstallPromptEvent;
    host.dispatchEvent(new Event('myclash:install-offer'));
  });
  host.addEventListener('appinstalled', function () {
    host.__myclashInstallOffer = null;
    host.dispatchEvent(new Event('myclash:install-offer'));
  });
}

/** The inline script of a root layout: runs `captureInstallOffer` on the page's window. */
export const INSTALL_CAPTURE_SCRIPT = `(${captureInstallOffer.toString()})(window);`;

/** The offer kept on the host, or null. The same object until it changes: a stable snapshot. */
export function readInstallOffer(host: InstallHost = window): InstallPromptEvent | null {
  return host.__myclashInstallOffer ?? null;
}

/** The server has no browser, so no offer. */
export const noInstallOffer = (): null => null;

/** Calls `listener` each time the kept offer changes. Returns the unsubscribe. */
export function subscribeInstallOffer(
  listener: () => void,
  host: InstallHost = window,
): () => void {
  host.addEventListener(CHANGED, listener);
  return () => host.removeEventListener(CHANGED, listener);
}

/**
 * Opens Chrome's install dialog. An event opens it once, so the offer is
 * dropped first: a second tap never asks a spent event. When the person says
 * no, Chrome may send a new offer later, and the button comes back with it.
 */
export function askToInstall(host: InstallHost = window): Promise<unknown> {
  const offer = readInstallOffer(host);
  if (!offer) return Promise.resolve();
  host.__myclashInstallOffer = null;
  host.dispatchEvent(new Event(CHANGED));
  return offer.prompt();
}
