'use client';

import { useSyncExternalStore } from 'react';
import { manifestHrefFor } from '../lib/nav';

/** The address never changes without a navigation that remounts the layout: nothing to hear. */
const subscribe = (): (() => void) => () => {};

/**
 * The page's link to the install manifest, decided in the browser: the server
 * cannot tell the two mounts apart (Traefik strips `/staff` before the request
 * arrives), so the worker registration decides there too
 * (`worker-registration.ts`). React puts a `<link>` in `<head>`.
 */
export function ManifestLink() {
  const href = useSyncExternalStore(
    subscribe,
    () => manifestHrefFor(window.location.pathname),
    () => null,
  );
  return href ? <link rel="manifest" href={href} /> : null;
}
