import { NextResponse } from 'next/server';
import { getApiUrl } from '@/lib/api-url';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * SSR-reachability probe for the public app.
 *
 * Performs the same server-side fetch the public pages do (against
 * `getApiUrl() + /api/v1/events`) and surfaces the underlying cause
 * (ENOTFOUND, ECONNREFUSED, TLS handshake failure, etc.) when it
 * fails. Wired to the Docker healthcheck in
 * `infra/docker-compose.prod.yml` so a misconfigured API URL is
 * caught at deploy time — the container goes UNHEALTHY and the
 * deploy script's healthcheck poll fails fast — rather than users
 * hitting an "Events are temporarily unavailable" banner.
 *
 * Returns:
 * - 200 with `{ ok: true, target, status }` when the SSR fetch
 *   completes with a 2xx response.
 * - 503 with `{ ok: false, target, status?, error?, cause? }` when
 *   the fetch fails or returns a non-2xx. The body is intended to
 *   be human-readable in `docker logs` / curl output, not consumed
 *   by callers.
 */
export async function GET(): Promise<NextResponse> {
  const target = `${getApiUrl()}/api/v1/events`;
  try {
    const res = await fetch(target, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, target, status: res.status, statusText: res.statusText },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, target, status: res.status });
  } catch (err) {
    const cause =
      err instanceof Error && 'cause' in err
        ? (err as Error & { cause?: unknown }).cause
        : undefined;
    return NextResponse.json(
      {
        ok: false,
        target,
        error: err instanceof Error ? err.message : String(err),
        cause:
          cause instanceof Error ? { name: cause.name, message: cause.message } : (cause ?? null),
      },
      { status: 503 },
    );
  }
}
