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

/** Where on `window` the offer is kept. */
const KEPT = '__myclashInstallOffer';

/** Sent on the host each time the kept offer changes. */
const CHANGED = 'myclash:install-offer';

/** Where the offer is kept, and the events it is told by. A `window`, or a test's double. */
export interface InstallHost extends EventTarget {
  [KEPT]?: InstallPromptEvent | null;
}

/**
 * The inline script of a root layout: keeps the browser's offer, and drops it
 * once the app is installed.
 *
 * TEXT, not a function turned into text. It was `captureInstallOffer.toString()`,
 * and the apps' production minifier rewrites that function: had it ever moved a
 * literal out of the body, the script would have thrown in the browser, and no
 * test would have gone red (the browser suite runs `next dev`). A minifier never
 * changes the inside of a string. The names come from `KEPT` and `CHANGED`, so
 * the script and the store cannot disagree.
 */
export const INSTALL_CAPTURE_SCRIPT = `(function (w) {
  w.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    w.${KEPT} = e;
    w.dispatchEvent(new Event('${CHANGED}'));
  });
  w.addEventListener('appinstalled', function () {
    w.${KEPT} = null;
    w.dispatchEvent(new Event('${CHANGED}'));
  });
})(window);`;

/** The offer kept on the host, or null. The same object until it changes: a stable snapshot. */
export function readInstallOffer(host: InstallHost = window): InstallPromptEvent | null {
  return host[KEPT] ?? null;
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
 *
 * A dialog Chrome refuses to open is said in the console, not thrown: it is
 * the browser's answer, not a fault of the app, and an uncaught rejection went
 * to Sentry as one.
 */
export async function askToInstall(host: InstallHost = window): Promise<void> {
  const offer = readInstallOffer(host);
  if (!offer) return;
  host[KEPT] = null;
  host.dispatchEvent(new Event(CHANGED));
  try {
    await offer.prompt();
  } catch (err) {
    console.warn('[install] Chrome did not open its install dialog:', err);
  }
}
