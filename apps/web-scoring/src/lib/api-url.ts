/**
 * Resolve the base URL for `/api/v1/*` fetches.
 *
 * - In a browser: returns `''` so fetches are relative to the current
 *   origin. This lets the scoring bundle work both at its own
 *   origin (scoring.myclash.fr) and behind a same-origin reverse proxy
 *   (e.g. admin.myclash.fr/scoring/*), without rebuilding.
 * - On the server (SSR/tests): falls back to the build-time env var
 *   or localhost so SSR fetches and unit tests keep working.
 */
export function getApiUrl(): string {
  if (typeof window !== 'undefined') return '';
  return process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
}
