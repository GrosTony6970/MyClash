/**
 * Asks the running ops runner whether one of its jobs holds the ops lock, and prints one line:
 * `free`, `held <kind> <since>`, or `unknown <reason>`. deploy.sh, redeploy.sh and rollback.sh run
 * it inside the runner (`docker exec myclash-ops-runner node infra/ops-runner/ops-lock-probe.mjs`,
 * infra/scripts/lib/ops-jobs-wait.sh) before they move the checkout: a backup, a restore or a
 * container action already running would otherwise run beside the rebuild (ruling 898).
 *
 * Only the server can say "held": the lock file names a process, and only that process knows
 * whether its job still runs (ops-lock.mjs). The runner's working dir is the repo's bind mount, so
 * even an old runner image runs this file; its server, without GET /ops-lock, answers 404 →
 * `unknown status-404`, and the deploy goes on. Always exits 0; the secret never leaves the env.
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const TIMEOUT_MS = 5_000;
const WORD = /^[A-Za-z0-9_.:-]{1,64}$/u;
const word = (value) => (typeof value === 'string' && WORD.test(value) ? value : 'unknown');

/** The one line for an answer: `{ status, body }`, or `{ error }` when none came. */
export function describeOpsLock({ status, body, error }) {
  if (error || status === undefined) return 'unknown unreachable';
  if (status !== 200) return `unknown status-${status}`;
  let state;
  try {
    state = JSON.parse(body);
  } catch {
    return 'unknown bad-answer';
  }
  if (state?.held === false) return 'free';
  if (state?.held === true) return `held ${word(state.kind)} ${word(state.since)}`;
  return 'unknown bad-answer';
}

function ask() {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: 'localhost',
        port: Number(process.env.OPS_RUNNER_PORT ?? 4075),
        path: '/ops-lock',
        headers: { authorization: `Bearer ${process.env.OPS_RUNNER_SECRET ?? ''}` },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (error) => resolve({ error }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(describeOpsLock(await ask()));
}
