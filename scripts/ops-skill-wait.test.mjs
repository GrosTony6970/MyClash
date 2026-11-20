/**
 * `door.mjs wait-up`: a `silent` run's wait before its round (ruling 903). The outside watcher
 * fires when the worker stops pinging, and a wipe + deploy stops it for 10 to 20 minutes: the run
 * polls `versions` until the platform answers or nine minutes pass, all in one Bash call.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { WAIT_UP_BUDGET_MS, WAIT_UP_POLL_MS, waitUp } from '../.claude/skills/myclash-ops/door.mjs';
import { noProxyEnv } from './lib/no-proxy-env.mjs';

/** A fake clock; each read takes `readMs` and answers the next entry of `answers`. */
function platform(answers, readMs = 1_000) {
  let t = 0;
  const asked = [];
  const deps = {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    request: async (route, options) => {
      asked.push({ route, options, at: t });
      t += readMs;
      return answers[Math.min(asked.length - 1, answers.length - 1)];
    },
  };
  return { deps, asked, clock: () => t };
}

const UP = { status: 200, body: '{}' };
const DOWN = { error: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) };
const EDGE_404 = { status: 404, body: '<html>' };

describe('waitUp', () => {
  it('up at once: one read, no wait', async () => {
    const { deps, asked } = platform([UP]);
    assert.deepEqual(await waitUp(deps), { up: true, line: 'up after 1s' });
    assert.equal(asked.length, 1);
    assert.equal(asked[0].route, 'versions');
  });

  it('down, then up: polls every 60 s and says how long it waited', async () => {
    const { deps, asked } = platform([DOWN, EDGE_404, UP]);
    assert.deepEqual(await waitUp(deps), { up: true, line: 'up after 123s' });
    assert.equal(asked.length, 3);
    assert.equal(asked[1].at - asked[0].at, 1_000 + WAIT_UP_POLL_MS);
  });

  it('never up: stops by the deadline and names the last answer', async () => {
    const { deps, asked, clock } = platform([DOWN]);
    assert.deepEqual(await waitUp(deps), {
      up: false,
      line: 'still down unreachable ECONNREFUSED',
    });
    assert.ok(clock() <= WAIT_UP_BUDGET_MS + 20_000, `ended at ${clock()} ms`);
    assert.ok(asked.length >= 8, `${asked.length} reads`);
  });

  it('fits one Bash call: nine minutes, each read bounded at 20 s', async () => {
    assert.equal(WAIT_UP_BUDGET_MS, 9 * 60_000);
    const { deps, asked, clock } = platform([DOWN], 20_000);
    await waitUp(deps);
    assert.ok(clock() < 600_000, `ended at ${clock()} ms`);
    assert.equal(asked[0].options.timeout, 20_000);
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

  it('a refused key is an answer: the platform is up, the round says the rest', async () => {
    const { deps, asked } = platform([{ status: 401, body: '' }]);
    assert.deepEqual(await waitUp(deps), { up: true, line: 'up after 1s' });
    assert.equal(asked.length, 1);
  });
});
