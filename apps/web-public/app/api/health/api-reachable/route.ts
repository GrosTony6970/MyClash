import { NextResponse } from 'next/server';
import { getServerApiUrl } from '@/lib/api-url';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * SSR-reachability probe for the public app.
 *
 * Performs the same server-side fetch the public pages do (against
 * `getServerApiUrl() + /api/v1/events`) and surfaces the underlying cause
 * (ENOTFOUND, ECONNREFUSED, TLS handshake failure, etc.) when it
 * fails. Wired to the Docker healthcheck in
 * `infra/docker-compose.prod.yml` so a misconfigured API URL is
 * caught at deploy time — the container goes UNHEALTHY and the
 * deploy script's healthcheck poll fails fast — rather than users
 * hitting an "Events are temporarily unavailable" banner.
 *
 * Returns:
 * - 200 with `{ ok: true, status }` when the SSR fetch completes
 *   with a 2xx response.
 * - 503 with `{ ok: false, status? }` when the fetch fails or
 *   returns a non-2xx.
 *
 * The probe target and failure cause are logged, never returned.
 * Traefik routes only `/api/v1` to the API
 * (`infra/docker-compose.prod.yml`), so `/api/health/*` falls
 * through to this app and is reachable unauthenticated from the
 * internet — a response body naming `api:4000` would hand the
 * internal topology to anyone who curls it. The compose
 * healthcheck only reads the status code; the detail belongs in
 * `docker logs`.
 */
export async function GET(): Promise<NextResponse> {
  const target = `${getServerApiUrl()}/api/v1/events`;
  try {
    const res = await fetch(target, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error(`[health/api-reachable] ${target} returned ${res.status} ${res.statusText}`);
      return NextResponse.json({ ok: false, status: res.status }, { status: 503 });
    }
    return NextResponse.json({ ok: true, status: res.status });
  } catch (err) {
    const cause =
      err instanceof Error && 'cause' in err
        ? (err as Error & { cause?: unknown }).cause
        : undefined;
    console.error(
      `[health/api-reachable] ${target} unreachable: ${
        err instanceof Error ? err.message : String(err)
      }`,
      cause instanceof Error ? `cause: ${cause.name}: ${cause.message}` : (cause ?? ''),
    );
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
