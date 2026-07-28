'use client';

import { MaintenanceBanner } from '@myclash/ui';
import { getPublicApiUrl } from '@/lib/api-url';

/**
 * Client wrapper around the shared MaintenanceBanner.
 *
 * The banner's feature-flags fetch runs in the BROWSER, so the API URL must be
 * resolved in a Client Component. The root layout is a Server Component —
 * reading the value there and passing it down ships whatever the server
 * resolved into the RSC payload. That is benign only while web-admin has a
 * single browser-facing API URL; the day this app grows an SSR fetch (and with
 * it an `API_URL_INTERNAL` / `getServerApiUrl()` split, as web-public has), the
 * server value becomes the docker-internal host and the banner breaks silently.
 *
 * Ported from web-public's `app/_components/RuntimeBanner.tsx`, which exists
 * for exactly this reason.
 */
export function RuntimeBanner() {
  return <MaintenanceBanner apiUrl={getPublicApiUrl()} />;
}
