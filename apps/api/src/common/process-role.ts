/**
 * Which part of the API this process runs (rulings 807, 808). One image, two containers: the
 * `api` service starts `node dist/main.js` and serves the API, with no queue consumer; the `worker`
 * service adds `--worker` (infra/docker-compose.*.yml, pinned by infra:review) and runs the queue
 * consumers and the auto-lock scan, serving /health alone. main.ts reads it once.
 */
export type ProcessRole = 'api' | 'worker';

export function processRole(argv: readonly string[]): ProcessRole {
  return argv.includes('--worker') ? 'worker' : 'api';
}
