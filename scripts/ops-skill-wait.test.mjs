/**
 * `door.mjs wait-up`: a `silent` run's wait before its round (rulings 903, 904). The outside
 * watcher fires when the worker stops pinging, and a wipe + deploy stops it for 10 to 20 minutes:
 * the run reads `runtime-health` until the platform answers AND the worker has pinged again, or
 * nine minutes pass, all in one Bash call. A platform that answers while the worker stays silent
 * is not "up": a stuck worker looks healthy from outside (ruling 904).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  PING_FRESH_MS,
  WAIT_UP_BUDGET_MS,
  WAIT_UP_POLL_MS,
  waitUp,
} from '../.claude/skills/myclash-ops/door.mjs';
import { noProxyEnv } from './lib/no-proxy-env.mjs';

const T0 = Date.parse('2026-11-20T12:00:00.000Z');

/**
 * A fake clock from T0; each read takes `readMs` and answers `answer(t, n)` for the n-th read.
 */
function platform(answer, readMs = 1_000) {
  let t = T0;
  const asked = [];
  const deps = {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    request: async (route, options) => {
      asked.push({ route, options, at: t });
      const result = answer(t, asked.length);
      t += readMs;
      return result;
    },
  };
  return { deps, asked, elapsed: () => t - T0 };
}

/** The door's runtime-health answer with the worker's last ping at `pingedAt`. */
function health(pingedAt, { failing = false } = {}) {
  const at = new Date(pingedAt).toISOString();
  const state = { config: 'configured', checkedAt: at, lastOkAt: failing ? null : at, failing };
  return {
    status: 200,
    body: JSON.stringify({ overall: 'healthy', agentWatcher: { read: 'ok', state } }),
  };
}
const DOWN = { error: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) };
const EDGE_404 = { status: 404, body: '<html>' };
/** The ping the stuck worker sent last: 20 minutes before the run. */
const STALE = T0 - 20 * 60_000;

describe('waitUp (rulings 903, 904)', () => {
  it('up and pinging at once: one read of runtime-health, no wait', async () => {
    const { deps, asked } = platform((t) => health(t - 60_000));
    assert.deepEqual(await waitUp(deps), { end: 'up', line: 'up after 1s' });
    assert.equal(asked.length, 1);
    assert.equal(asked[0].route, 'runtime-health');
  });

  it('down, then up and pinging: polls every 60 s and says how long it waited', async () => {
    const { deps, asked } = platform((t, n) => [DOWN, EDGE_404][n - 1] ?? health(t));
    assert.deepEqual(await waitUp(deps), { end: 'up', line: 'up after 123s' });
    assert.equal(asked.length, 3);
    assert.equal(asked[1].at - asked[0].at, 1_000 + WAIT_UP_POLL_MS);
  });

  it('the site answers before the worker pings again (a wipe ending): it waits for the ping', async () => {
    const { deps, asked } = platform((t, n) => (n < 3 ? health(STALE) : health(t)));
    assert.deepEqual(await waitUp(deps), { end: 'up', line: 'up after 123s' });
    assert.equal(asked.length, 3);
  });

  it('the site answers but the worker never pings again: no ping, by the deadline', async () => {
    const { deps, elapsed } = platform(() => health(STALE));
    assert.deepEqual(await waitUp(deps), {
      end: 'no-ping',
      line: 'up, no ping since 2026-11-20T11:40:00.000Z',
    });
    assert.ok(elapsed() <= WAIT_UP_BUDGET_MS + 30_000, `ended at ${elapsed()} ms`);
  });

  it('a ping that fails to reach the watcher is no ping; no state at all is none either', async () => {
    const failing = platform((t) => health(t, { failing: true }));
    assert.deepEqual(await waitUp(failing.deps), {
      end: 'no-ping',
      line: 'up, no ping since unknown',
    });
    const unseen = platform(() => ({
      status: 200,
      body: JSON.stringify({ overall: 'healthy', agentWatcher: { read: 'not_checked' } }),
    }));
    assert.equal((await waitUp(unseen.deps)).end, 'no-ping');
  });

  it('a ping is fresh for six minutes: one tick and its slack', () => {
    assert.equal(PING_FRESH_MS, 6 * 60_000);
  });

  it('never up: stops by the deadline and names the last answer', async () => {
    const { deps, asked, elapsed } = platform(() => DOWN);
    assert.deepEqual(await waitUp(deps), {
      end: 'down',
      line: 'still down unreachable ECONNREFUSED',
    });
    assert.ok(elapsed() <= WAIT_UP_BUDGET_MS + 30_000, `ended at ${elapsed()} ms`);
    assert.ok(asked.length >= 8, `${asked.length} reads`);
  });

  it('fits one Bash call: nine minutes, each read bounded at 30 s', async () => {
    assert.equal(WAIT_UP_BUDGET_MS, 9 * 60_000);
    const { deps, asked, elapsed } = platform(() => DOWN, 30_000);
    await waitUp(deps);
    assert.ok(elapsed() < 600_000, `ended at ${elapsed()} ms`);
    assert.equal(asked[0].options.timeout, 30_000);
  });

  it('a refused key is an answer: the round says the rest', async () => {
    const { deps, asked } = platform(() => ({ status: 401, body: '' }));
    assert.deepEqual(await waitUp(deps), { end: 'up', line: 'up after 1s' });
    assert.equal(asked.length, 1);
  });

  it('on the command line: no key, exit 2 before any call', () => {
    const env = noProxyEnv({});
    delete env.OPS_AGENT_KEY;
    const run = spawnSync(process.execPath, ['.claude/skills/myclash-ops/door.mjs', 'wait-up'], {
      env,
      encoding: 'utf8',
    });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /OPS_AGENT_KEY is missing/);
  });
});
