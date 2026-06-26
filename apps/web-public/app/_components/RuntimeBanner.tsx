'use client';

import { MaintenanceBanner } from '@myclash/ui';
import { getApiUrl } from '@/lib/api-url';

/**
 * Client wrapper around the shared MaintenanceBanner.
 *
 * The banner's feature-flags fetch runs in the BROWSER, so it must use the
 * public, browser-reachable API URL. The root layout is a Server Component —
 * calling `getApiUrl()` there returns the SSR-only `API_URL_INTERNAL`
 * (`http://api:4000`, the in-Docker hostname), which the browser then blocks as
 * mixed content. Resolving `getApiUrl()` here (a Client Component) returns
 * `NEXT_PUBLIC_API_URL` (same-origin `https://app.<domain>`) instead.
 */
export function RuntimeBanner() {
  return <MaintenanceBanner apiUrl={getApiUrl()} />;
}
