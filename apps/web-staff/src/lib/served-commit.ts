/**
 * The commit this container serves, in 8 characters, or `unknown`.
 *
 * Read at RUN time, on the server only. `GIT_COMMIT` is deliberately not a
 * build argument (a per-commit argument would make every build miss the image
 * cache; see the compose file), so a value read at build time would be
 * `unknown` for ever.
 *
 * Two readers: `GET /api/version`, and the registration of the service worker,
 * whose cache takes this as its version (`ServiceWorkerRegistration.tsx`).
 * Truncated to 8 like the API's `shortCommit`, so one deploy never shows as two
 * different-looking commits.
 */
export function servedCommit(): string {
  // Only what a commit is made of: this goes into an address, and into a script.
  const commit = (process.env['GIT_COMMIT'] || 'unknown').replace(/[^\w.-]/g, '').slice(0, 8);
  return commit || 'unknown';
}
