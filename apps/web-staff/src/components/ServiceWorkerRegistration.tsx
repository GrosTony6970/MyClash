import { servedCommit } from '../lib/served-commit';
import { registrationScript } from '../lib/worker-registration';

/**
 * Registers the offline service worker.
 *
 * A blocking inline <script> rather than a `useEffect`, on purpose: the pad is
 * used on venue wifi that drops mid-bout, so the worker has to be claimed as
 * early as possible rather than after React hydrates. Extracted from the root
 * layout only so the layout stays readable.
 *
 * A Server Component: the worker is registered under the commit this container
 * serves, read on the server per request (`worker-registration.ts` says why).
 */
export function ServiceWorkerRegistration() {
  return <script dangerouslySetInnerHTML={{ __html: registrationScript(servedCommit()) }} />;
}
