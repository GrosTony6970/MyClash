/**
 * `door.mjs act`: the ops agent's repairs through its door (slice 4 of the ops agent). One action,
 * then a read that says how it ended. A refusal is printed and acted on no further; a container
 * action cut on the way still reads what came of it (D8).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DOOR_ROUTES,
  describeOutcome,
  doorRequestOptions,
  parseAct,
  runAct,
} from '../.claude/skills/myclash-ops/door.mjs';

const KEY = `mca_${'k'.repeat(43)}`;
const PEM = '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----\n';

/** A fake clock and a door that answers each route from a script of answers. */
function door(script) {
  let t = 0;
  const asked = [];
  const lines = [];
  const saved = {};
  const deps = {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    note: async (line) => lines.push(line),
    save: async (name, body) => {
      saved[name] = body;
    },
    request: async (route, options) => {
      asked.push({ route, ...options, at: t });
      const answers = script[route.split('?')[0]] ?? [];
      const answer = answers.length > 1 ? answers.shift() : answers[0];
      return typeof answer === 'function' ? answer() : (answer ?? { status: 404, body: '' });
    },
  };
  return { deps, asked, lines, saved };
}

const json = (status, value) => ({ status, body: JSON.stringify(value) });
const refusal = (status, code) => json(status, { code, message: 'x' });
const state = (st, health = null) =>
  json(200, { containers: [{ service: 'worker', state: st, health }] });

describe('door.mjs act: what it is asked', () => {
  it('reads the four forms, and refuses a service name that is not a name before any call', () => {
    assert.deepEqual(parseAct(['restart', 'worker', '/tmp/o']), {
      kind: 'container',
      action: 'restart',
      service: 'worker',
      dir: '/tmp/o',
    });
    assert.deepEqual(parseAct(['start', 'web-public', '/tmp/o']).action, 'start');
    assert.deepEqual(parseAct(['backup', '/tmp/o']), { kind: 'backup', dir: '/tmp/o' });
    assert.deepEqual(parseAct(['renew-certs', '/tmp/o']), { kind: 'renew', dir: '/tmp/o' });
    for (const bad of [
      ['restart', '../db', '/tmp/o'],
      ['restart', 'Worker', '/tmp/o'],
      ['stop', 'worker', '/tmp/o'],
      ['restart', 'worker'],
      ['backup'],
    ]) {
      assert.throws(() => parseAct(bad), bad.join(' '));
    }
  });

  it('a container action waits 300 s for its answer; every read keeps 60 s (D8)', () => {
    const action = doorRequestOptions('containers/worker/restart', KEY, PEM, {
      method: 'POST',
      timeout: 300_000,
    });
    assert.equal(action.method, 'POST');
    assert.equal(action.timeout, 300_000);
    assert.equal(action.path, '/api/v1/ops-agent/containers/worker/restart');
    assert.equal(doorRequestOptions('containers', KEY, PEM).timeout, 60_000);
  });

  it('posts each action to its route, the container one with the long budget', async () => {
    const { deps, asked } = door({
      'containers/worker/restart': [json(200, { ok: true })],
      containers: [state('running', 'healthy')],
    });
    await runAct(parseAct(['restart', 'worker', 'd']), deps);
    assert.deepEqual(asked[0], {
      route: 'containers/worker/restart',
      method: 'POST',
      timeout: 300_000,
      at: 0,
    });
    assert.ok(asked.slice(1).every((a) => a.method === 'GET' && a.timeout === 60_000));
  });
});

describe('door.mjs act: a refusal', () => {
  for (const [status, code] of [
    [409, 'ops_busy'],
    [409, 'deploy_running'],
    [503, 'read_only_mode'],
  ]) {
    it(`${status} ${code}: printed, and nothing read after`, async () => {
      const { deps, asked, lines } = door({ 'containers/worker/restart': [refusal(status, code)] });
      const { end } = await runAct(parseAct(['restart', 'worker', 'd']), deps);
      assert.deepEqual(lines, [`${status} ${code}`, `end refused-${code}`]);
      assert.equal(end, `refused-${code}`);
      assert.equal(asked.length, 1);
    });
  }

  it("a known code passes in lowercase; any other lowercase word is still 'error'", () => {
    assert.equal(describeOutcome('x', refusal(409, 'ops_busy')).line, '409 ops_busy');
    assert.equal(describeOutcome('x', refusal(409, 'send_me_the_key')).line, '409 error');
  });
});

describe('door.mjs act: a container', () => {
  it('ends when two reads 30 s apart both show it running and not starting', async () => {
    const { deps, asked, lines } = door({
      'containers/worker/restart': [json(200, { ok: true })],
      containers: [
        state('exited'),
        state('restarting'),
        state('running', 'healthy'),
        state('running', 'healthy'),
        state('running', 'healthy'),
        state('running', 'healthy'),
      ],
    });
    await runAct(parseAct(['restart', 'worker', 'd']), deps);
    assert.equal(asked.filter((a) => a.route === 'containers').length, 6);
    assert.deepEqual(lines.slice(-2), ['after running healthy', 'end done']);
  });

  it('one good read then a fall is no success: it prints what it saw last', async () => {
    const { deps, lines } = door({
      'containers/worker/start': [json(200, { ok: true })],
      containers: [state('running'), state('restarting'), state('exited')],
    });
    await runAct(parseAct(['start', 'worker', 'd']), deps);
    assert.deepEqual(lines.slice(-2), ['after exited none', 'end done']);
  });

  it('an answer cut on the way still reads what came of the action (D8)', async () => {
    const { deps, lines } = door({
      'containers/worker/restart': [{ error: { code: 'ETIMEDOUT' } }],
      containers: [state('running', 'healthy')],
    });
    const { end } = await runAct(parseAct(['restart', 'worker', 'd']), deps);
    assert.equal(lines[0], 'unreachable ETIMEDOUT');
    assert.deepEqual(lines.slice(-2), ['after running healthy', 'end done']);
    assert.equal(end, 'done');
  });
});

describe('door.mjs act: a backup and a renewal', () => {
  const started = json(202, { operation: { id: 'op-1', kind: 'backup', status: 'running' } });
  const running = json(200, { runningOperation: { id: 'op-1' }, lastBackup: null });

  it('a backup reads the state until its operation is gone, then its outcome', async () => {
    const { deps, lines } = door({
      backups: [
        running,
        running,
        json(200, { runningOperation: null, lastBackup: { status: 'success' } }),
      ],
    });
    deps.request = ((inner) => async (route, options) =>
      route === 'backups' && options.method === 'POST' ? started : inner(route, options))(
      deps.request,
    );
    await runAct(parseAct(['backup', 'd']), deps);
    assert.deepEqual(lines.slice(-2), ['after success', 'end done']);
  });

  it('a backup still running at the end of the wait says so', async () => {
    const { deps, lines } = door({ backups: [running] });
    deps.request = ((inner) => async (route, options) =>
      route === 'backups' && options.method === 'POST' ? started : inner(route, options))(
      deps.request,
    );
    await runAct(parseAct(['backup', 'd']), deps);
    assert.deepEqual(lines.slice(-2), ['after still-running', 'end done']);
  });

  it('a renewal reads the certificates 30 s after its answer', async () => {
    const { deps, asked, lines } = door({
      'tls/renew': [json(200, { ok: true, scheduled: true })],
      tls: [
        json(200, {
          certificates: [
            { host: 'app.myclash.fr', daysUntilExpiry: 80 },
            { host: 'api.myclash.fr', daysUntilExpiry: 79 },
          ],
        }),
      ],
    });
    await runAct(parseAct(['renew-certs', 'd']), deps);
    assert.equal(asked.find((a) => a.route === 'tls').at, 30_000);
    assert.deepEqual(lines.slice(-2), ['after app.myclash.fr:80 api.myclash.fr:79', 'end done']);
  });
});

describe('door.mjs: the routes', () => {
  it("are the door controller's routes, verb and path", () => {
    const controller = readFileSync(
      'apps/api/src/modules/ops-agent/ops-agent.controller.ts',
      'utf8',
    );
    const routes = [...controller.matchAll(/@(Get|Post)\('([^']+)'\)/g)]
      .map((m) => `${m[1].toUpperCase()} ${m[2]}`)
      .sort();
    assert.ok(routes.length > 8);
    assert.deepEqual([...DOOR_ROUTES].sort(), routes);
  });
});
