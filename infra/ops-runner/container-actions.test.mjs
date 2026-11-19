import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RESTARTABLE_COMPONENTS } from '../../apps/api/src/modules/admin/restartable-components.ts';
import {
  RESTARTABLE_SERVICES,
  createContainerActions,
  createDeployRunning,
} from './container-actions.mjs';
import { OpsLockBusyError } from './ops-lock.mjs';

const FLAGS = ['--env-file', '/srv/myclash/.env', '-f', 'infra/docker-compose.prod.yml'];
const OK = { code: 0, stdout: 'done', stderr: '', timedOut: false };

/** The actions with every dependency recorded in `events`. */
function harness({ lock = 'free', deploy = false, answer = OK } = {}) {
  const events = [];
  const scheduled = [];
  const actions = createContainerActions({
    composeFlags: FLAGS,
    run: async (command, args, timeoutMs) => {
      events.push(`run ${[command, ...args].join(' ')} ${timeoutMs}`);
      return answer;
    },
    withLock: async (kind, fn) => {
      if (lock === 'busy') throw new OpsLockBusyError();
      events.push(`lock ${kind}`);
      try {
        return await fn();
      } finally {
        events.push(`release ${kind}`);
      }
    },
    deployRunning: async () => deploy,
    schedule: (ms, fn) => scheduled.push({ ms, fn }),
    log: (line) => events.push(`log ${line}`),
  });
  return { actions, events, scheduled };
}

test('a container action runs under the ops lock, with the arguments of today', async () => {
  const { actions, events } = harness();
  const result = await actions.runContainerAction('worker', 'restart');
  assert.equal(result.ok, true);
  assert.deepEqual(events, [
    'lock container',
    `run docker compose ${FLAGS.join(' ')} restart -t 270 worker 285000`,
    'release container',
  ]);
});

test('a container action meets a held lock: 409 ops_busy, nothing runs (ruling 886)', async () => {
  const { actions, events } = harness({ lock: 'busy' });
  await assert.rejects(actions.runContainerAction('worker', 'restart'), {
    statusCode: 409,
    code: 'ops_busy',
  });
  assert.deepEqual(events, []);
});

test('a container action during a deploy: 409 deploy_running, no lock taken (ruling 887)', async () => {
  const { actions, events } = harness({ deploy: true });
  await assert.rejects(actions.runContainerAction('web-public', 'start'), {
    statusCode: 409,
    code: 'deploy_running',
  });
  assert.deepEqual(events, []);
});

test('a service off the list is refused before any lock', async () => {
  for (const service of ['db', 'api', 'traefik', 'ops-runner']) {
    const { actions, events } = harness();
    assert.deepEqual(await actions.runContainerAction(service, 'restart'), {
      ok: false,
      error: 'service_not_allowed',
    });
    assert.deepEqual(events, [], service);
  }
});

test('a renewal answers before Traefik restarts, and holds the lock until it has (D9)', async () => {
  const { actions, events, scheduled } = harness();
  const answer = await actions.runCertRenewal();
  assert.deepEqual(answer, {
    ok: true,
    scheduled: true,
    service: 'traefik',
    action: 'renew-certs',
    exitCode: null,
    timedOut: false,
  });
  assert.deepEqual(events, ['lock renew-certs']);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].ms, 3_000);
  await scheduled[0].fn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [
    'lock renew-certs',
    `run docker compose ${FLAGS.join(' ')} restart traefik 30000`,
    'release renew-certs',
  ]);
});

test('a renewal whose restart fails still releases the lock, and logs it', async () => {
  const { actions, events, scheduled } = harness({
    answer: { code: 1, stdout: '', stderr: 'boom', timedOut: false },
  });
  await actions.runCertRenewal();
  await scheduled[0].fn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.at(-1), 'release renew-certs');
  assert.ok(
    events.some((e) => e.startsWith('log ')),
    events.join('\n'),
  );
});

test('a renewal meets a held lock or a deploy: refused, nothing scheduled', async () => {
  const busy = harness({ lock: 'busy' });
  await assert.rejects(busy.actions.runCertRenewal(), { statusCode: 409, code: 'ops_busy' });
  assert.equal(busy.scheduled.length, 0);
  const deploying = harness({ deploy: true });
  await assert.rejects(deploying.actions.runCertRenewal(), {
    statusCode: 409,
    code: 'deploy_running',
  });
  assert.equal(deploying.scheduled.length, 0);
});

test("the runner's restartable list is the API's", () => {
  assert.deepEqual([...RESTARTABLE_SERVICES].sort(), Object.values(RESTARTABLE_COMPONENTS).sort());
});

// `.deploy.lock` is deploy.sh's flock (deploy.sh, LOCK_FILE). The real flock binary, where it is.
const noFlock = spawnSync('flock', ['--version']).status !== 0 ? 'needs flock (Linux)' : false;

test(
  'deployRunning: absent lock file → false, and the file is not created',
  { skip: noFlock },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'deploy-lock-'));
    const file = path.join(dir, '.deploy.lock');
    assert.equal(await createDeployRunning(file)(), false);
    assert.equal(existsSync(file), false);
    rmSync(dir, { recursive: true, force: true });
  },
);

test(
  'deployRunning: a free lock file → false; one held by flock → true',
  { skip: noFlock },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'deploy-lock-'));
    const file = path.join(dir, '.deploy.lock');
    writeFileSync(file, '');
    assert.equal(await createDeployRunning(file)(), false);
    const holder = spawn('flock', [file, 'sleep', '5']);
    await new Promise((resolve) => setTimeout(resolve, 300));
    try {
      assert.equal(await createDeployRunning(file)(), true);
    } finally {
      holder.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
