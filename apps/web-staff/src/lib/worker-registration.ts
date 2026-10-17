import { STAFF_MOUNT } from './nav';

/**
 * The address the service worker is registered under, and the script that
 * registers it. Plain strings, so the unit tests read them: the pad's tests do
 * not render a component.
 *
 * THE VERSION. The worker keeps pages and scripts on the tablet, and must drop
 * them when the app changes. Its cache is named after the `v` of its own
 * address (`public/sw.js`), and `v` is the commit this container serves
 * (`served-commit.ts`). So a deploy gives every tablet a new worker at its next
 * page with a network: the new worker fills a new cache, then removes the old
 * one. The deploy script used to stamp the cache name into the worker's file
 * with a `sed` whose pattern had stopped matching, behind `|| true`: the cache
 * was never renewed.
 *
 * THE MOUNT. One build serves the referee site at its root and the organiser
 * site under `/staff` (`src/lib/nav.ts`). On the organiser site `/sw.js` is the
 * organiser app's address, which has no worker: the registration failed and the
 * scoring screen had no offline copy there. So the page registers the worker
 * under its own mount, and the worker's reach is that folder: `/staff/` on the
 * organiser site, never the organiser app's own pages.
 */

/** The worker's address for one deploy, under the root mount. A new commit is a new address. */
export const workerUrl = (version: string) => `/sw.js?v=${version}`;

/**
 * The inline script of the root layout. `version` is `servedCommit()`: letters,
 * digits, dot and dash only, and it is JSON-encoded here, so it cannot end the
 * script it is written into. The mount is the rule of `staffRoutePrefix`, read
 * from the address the page was opened at.
 */
export function registrationScript(version: string): string {
  return `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  var mount = location.pathname.indexOf(${JSON.stringify(STAFF_MOUNT)}) === 0 ? ${JSON.stringify(STAFF_MOUNT)} : '';
                  navigator.serviceWorker.register(mount + ${JSON.stringify(workerUrl(version))})
                    .then(function(reg) { console.log('SW registered:', reg.scope); })
                    .catch(function(err) { console.warn('SW registration failed:', err); });
                });
              }
            `;
}
