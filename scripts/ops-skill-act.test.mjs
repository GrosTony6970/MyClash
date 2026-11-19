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

  // Final review of slice 4, I1: on a long restart the likely cut is a gateway's 5xx, or the API's
  // own uncoded 503 ("did not respond within 295s"), not a socket timeout. The restart probably
  // happened: read what came of it, never call it refused.
  for (const [label, answer, first] of [
    ['a gateway 504', { status: 504, body: '<html>' }, '504 error'],
    ['an uncoded 503', json(503, { message: 'did not respond' }), '503 error'],
  ]) {
    it(`${label} on a container action still reads what came of it`, async () => {
      const { deps, lines } = door({
        'containers/worker/restart': [answer],
        containers: [state('running', 'healthy')],
      });
      const { end } = await runAct(parseAct(['restart', 'worker', 'd']), deps);
      assert.equal(lines[0], first);
      assert.deepEqual(lines.slice(-2), ['after running healthy', 'end done']);
      assert.equal(end, 'done');
    });
  }
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

// Slice 4b: the disk prune (rulings 884, 895, 896).
describe('door.mjs act: a disk prune', () => {
  const disk = (value) => json(200, { overall: 'ok', disk: value });

  it('reads its form, and refuses one with no folder or a word too many', () => {
    assert.deepEqual(parseAct(['prune', '/tmp/o']), { kind: 'prune', dir: '/tmp/o' });
    assert.throws(() => parseAct(['prune']));
    assert.throws(() => parseAct(['prune', 'docker', '/tmp/o']));
  });

  it('posts disk/prune with the long budget, then reads the disk once', async () => {
    const { deps, asked, lines } = door({
      'disk/prune': [json(200, { ok: true, service: 'docker', action: 'prune' })],
      'runtime-health': [disk({ status: 'healthy', usePercent: 61 })],
    });
    const { end } = await runAct(parseAct(['prune', 'd']), deps);
    assert.deepEqual(
      asked.map((a) => `${a.method} ${a.route} ${a.timeout}`),
      ['POST disk/prune 300000', 'GET runtime-health 60000'],
    );
    assert.deepEqual(lines, ['200 act prune', 'after healthy 61%', 'end done']);
    assert.equal(end, 'done');
  });

  it('a disk it could not read says so', async () => {
    const { deps, lines } = door({
      'disk/prune': [json(200, { ok: true })],
      'runtime-health': [disk({ status: 'unavailable' })],
    });
    await runAct(parseAct(['prune', 'd']), deps);
    assert.deepEqual(lines.slice(-2), ['after unknown', 'end done']);
  });

  it('a held lock is a refusal, and nothing is read after', async () => {
    const { deps, asked, lines } = door({ 'disk/prune': [refusal(409, 'ops_busy')] });
    const { end } = await runAct(parseAct(['prune', 'd']), deps);
    assert.deepEqual(lines, ['409 ops_busy', 'end refused-ops_busy']);
    assert.equal(end, 'refused-ops_busy');
    assert.equal(asked.length, 1);
  });

  // A prune runs up to 280 s: like a long restart, an answer cut on the way is no refusal.
  for (const [label, answer, first] of [
    ['a gateway 504', { status: 504, body: '<html>' }, '504 error'],
    ['a cut with no answer at all', { error: { code: 'ECONNRESET' } }, 'unreachable ECONNRESET'],
  ]) {
    it(`${label} still reads the disk after`, async () => {
      const { deps, lines } = door({
        'disk/prune': [answer],
        'runtime-health': [disk({ status: 'warning', usePercent: 83 })],
      });
      const { end } = await runAct(parseAct(['prune', 'd']), deps);
      assert.deepEqual(lines, [first, 'after warning 83%', 'end done']);
      assert.equal(end, 'done');
    });
  }
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
