/**
 * Starting or restarting one listed container, renewing the certificates (by restarting Traefik),
 * and the disk prune. `server.mjs` routes here; the API's admin console and the ops agent's door
 * (`apps/api/src/modules/ops-agent`) are the two callers. Out of server.mjs so it can be tested:
 * server.mjs listens and awaits at the top level.
 *
 * Every action runs under the ops lock (ruling 886): a backup, a restore, an upload, a delete or
 * another action holding it means `409 ops_busy`. Each is refused while a deploy holds its own
 * lock (`.deploy.lock`, ruling 887): `409 deploy_running`.
 */
import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { refusal } from './upload-store.mjs';

// Allowlist of compose service names that may be controlled. Mirrored by the API
// (`RESTARTABLE_COMPONENTS`, apps/api/src/modules/admin/restartable-components.ts); the test holds
// the two equal. Excludes: api (would kill the calling request), db (data outage), traefik (lose
// HTTPS for the whole stack; renewal restarts it through its own route), ops-runner (lose the
// channel that would restart anything else).
export const CONTAINER_ACTIONS = new Set(['start', 'stop', 'restart']);
export const RESTARTABLE_SERVICES = new Set([
  'worker',
  'web-admin',
  'web-public',
  'web-staff',
  'web-marketing',
  'redis',
  'supabase-auth',
  'supabase-realtime',
  'supabase-storage',
  'supabase-rest',
  'supabase-meta',
  'supabase-studio',
]);

/**
 * How long a container action may run. Any action on the worker waits for its
 * job in flight when it stops it. From the admin's button that wait is 270 s, not
 * the 5m of its stop_grace_period (rulings 811, 814, 818): the API's call to this
 * route is Node's fetch, which gives up when no answer has come after 300 s
 * (undici's headersTimeout), and this route answers once compose is done. So:
 * 270 s grace < this 285 s bound < the API's 295 s wait
 * (WORKER_ACTION_WAIT_MS, apps/api/src/modules/admin/system-actions.service.ts)
 * < 300 s. infra:review pins the order.
 */
const DEFAULT_ACTION_TIMEOUT_MS = 30_000;
const WORKER_STOP_GRACE_S = 270;
const WORKER_ACTION_TIMEOUT_MS = 285_000;

/**
 * Traefik carries the request that asks for the renewal: restarting it before the answer has
 * left would drop the answer (its stop grace is 10 s). So the answer goes first, and the restart
 * a moment later, still under the lock.
 */
const RENEW_DELAY_MS = 3_000;
const RENEW_TIMEOUT_MS = 30_000;

/**
 * The disk prune's two steps (ruling 884): the whole build cache, then the dangling images: the
 * old build of each image, untagged by its rebuild. Never volumes, and never every unused image:
 * `alpine:3`, the helper of backup.sh and restore.sh, is used by no container between their runs,
 * and a restore must not need Docker Hub. Host-wide, like `destroy.sh --prune-cache`.
 * Each step is bounded; two of them end before the API stops waiting (PRUNE_WAIT_MS,
 * apps/api/src/modules/admin/system-actions.service.ts), which ends before undici's 300 s.
 * infra:review pins the order.
 */
export const PRUNE_STEP_TIMEOUT_MS = 140_000;
const PRUNE_STEPS = [
  ['builder', 'prune', '--all', '--force'],
  ['image', 'prune', '--force'],
];

/**
 * `deps` = { run(command, args, timeoutMs), withLock(kind, fn), deployRunning(), freeBytes(),
 * schedule(ms, fn), composeFlags, log(line) }.
 */
export function createContainerActions(deps) {
  const bound = {
    ...deps,
    schedule: deps.schedule ?? ((ms, fn) => setTimeout(fn, ms).unref?.()),
    log: deps.log ?? ((line) => console.warn(line)),
  };
  return {
    runContainerAction: (service, action) => runContainerAction(bound, service, action),
    runCertRenewal: () => runCertRenewal(bound),
    runDiskPrune: () => runDiskPrune(bound),
  };
}

async function refuseDuringDeploy({ deployRunning }) {
  if (await deployRunning()) {
    throw refusal(409, 'A deploy is running on the server.', 'deploy_running');
  }
}

/**
 * Run a `docker compose <action> <service>` against the production compose
 * file. Bounded to the RESTARTABLE_SERVICES allowlist. Times out (see above)
 * and returns the captured stdio.
 */
async function runContainerAction(deps, service, action) {
  const { run, withLock, composeFlags } = deps;
  if (!CONTAINER_ACTIONS.has(action)) {
    return { ok: false, error: 'invalid_action' };
  }
  if (!RESTARTABLE_SERVICES.has(service)) {
    return { ok: false, error: 'service_not_allowed' };
  }
  await refuseDuringDeploy(deps);
  return withLock('container', async () => {
    const worker = service === 'worker';
    // `start` takes no timeout: only a stop (or a restart's stop) waits for a job.
    const grace = worker && action !== 'start' ? ['-t', String(WORKER_STOP_GRACE_S)] : [];
    const result = await run(
      'docker',
      ['compose', ...composeFlags, action, ...grace, service],
      worker ? WORKER_ACTION_TIMEOUT_MS : DEFAULT_ACTION_TIMEOUT_MS,
    );
    return {
      ok: result.code === 0,
      service,
      action,
      exitCode: result.code,
      stdout: result.stdout.slice(-4000),
      stderr: result.stderr.slice(-4000),
      timedOut: result.timedOut ?? false,
    };
  });
}

/**
 * Force a Let's Encrypt renewal attempt by restarting Traefik. On boot Traefik
 * re-runs its ACME resolver and renews any cert already inside its ~30-day
 * window; `acme.json` is never touched, so there is no LE rate-limit risk.
 * A deliberate, single-purpose exception to the RESTARTABLE_SERVICES allowlist:
 * it can only *restart* Traefik, never stop it. The answer says the restart is
 * scheduled; its result shows in the certificate state read after it. The lock
 * is held until the restart has ended.
 */
async function runCertRenewal(deps) {
  await refuseDuringDeploy(deps);
  return new Promise((resolve, reject) => {
    deps
      .withLock(
        'renew-certs',
        () =>
          new Promise((done) => {
            resolve({
              ok: true,
              scheduled: true,
              service: 'traefik',
              action: 'renew-certs',
              exitCode: null,
              timedOut: false,
            });
            deps.schedule(RENEW_DELAY_MS, () => restartTraefik(deps).finally(done));
          }),
      )
      .catch(reject);
  });
}

/**
 * Empty the build cache and remove the dangling images, under the ops lock. A failed step does not
 * stop the other. The space freed is the free bytes of the runner's root before and after: the
 * filesystem the disk health reads.
 */
async function runDiskPrune(deps) {
  await refuseDuringDeploy(deps);
  return deps.withLock('prune', async () => {
    const before = await deps.freeBytes();
    const results = [];
    for (const step of PRUNE_STEPS) {
      results.push(await deps.run('docker', step, PRUNE_STEP_TIMEOUT_MS));
    }
    const after = await deps.freeBytes();
    const failed = results.find((r) => r.code !== 0);
    return {
      ok: failed === undefined,
      service: 'docker',
      action: 'prune',
      exitCode: failed === undefined ? 0 : failed.code,
      timedOut: results.some((r) => r.timedOut === true),
      freedBytes: Math.max(0, after - before),
      availBytes: after,
      stderr: results
        .map((r) => r.stderr)
        .join('')
        .slice(-4000),
    };
  });
}

/** The renewal's restart, after its answer has left. A failure is logged, never thrown. */
function restartTraefik({ run, composeFlags, log }) {
  return run('docker', ['compose', ...composeFlags, 'restart', 'traefik'], RENEW_TIMEOUT_MS)
    .then((result) => {
      if (result.code !== 0 || result.timedOut) {
        log(`[renew-certs] restarting traefik failed (exit ${result.code})`);
      }
    })
    .catch((error) => log(`[renew-certs] restarting traefik failed: ${error}`));
}

/**
 * Whether a deploy holds `.deploy.lock` (deploy.sh, redeploy.sh and rollback.sh take it with
 * flock). The file is never created here: one made by this root-run container would stop the
 * next deploy, run as the operator, from opening it. So it is opened read-only (a missing file:
 * no deploy), and flock locks that fd: given a path, flock(1) opens it with O_CREAT, and a deploy
 * deleting the file on exit raced that open. Node's copy of the fd is closed once the child has
 * it, so the lock dies with flock and a deploy's own `flock -n` never meets it. An answer flock
 * gives that is neither "free" nor "held" counts as held: a repair can wait, a deploy cut in half
 * cannot be undone.
 */
export function createDeployRunning(lockFile, { spawn: spawnFn = spawn } = {}) {
  return async () => {
    let handle;
    try {
      handle = await open(lockFile, 'r');
    } catch (error) {
      return error?.code !== 'ENOENT';
    }
    return new Promise((resolve) => {
      const close = () => void handle.close().catch(() => undefined);
      const child = spawnFn('flock', ['-n', '-E', '75', '3'], {
        stdio: ['ignore', 'ignore', 'ignore', handle.fd],
      });
      child.on('spawn', close);
      child.on('close', (code) => resolve(code !== 0));
      child.on('error', () => {
        close();
        resolve(true);
      });
    });
  };
}
