'use client';

import { useSyncExternalStore } from 'react';
import { manifestHrefFor } from '../lib/nav';

/**
 * Nothing to hear: the answer is the MOUNT, and no in-app navigation crosses
 * between the root and `/staff` (each mount's links stay inside it).
 */
const subscribe = (): (() => void) => () => {};

/**
 * The page's link to the install manifest, decided in the browser: the server
 * cannot tell the two mounts apart (Traefik strips `/staff` before the request
 * arrives), so the worker registration decides there too
 * (`worker-registration.ts`). Rendered in `<head>` by `HomeScreenHead`.
 *
 * So the link exists only after hydration, and Chrome cannot offer to install
 * before React runs here. The early capture still matters on the public app,
 * whose manifest is in the server's HTML.
 */
export function ManifestLink() {
  const href = useSyncExternalStore(
    subscribe,
    () => manifestHrefFor(window.location.pathname),
    () => null,
  );
  return href ? <link rel="manifest" href={href} /> : null;
}
