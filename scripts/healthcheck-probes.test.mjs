import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Docker healthchecks are the operator's only window into a container that
 * refuses to go green, and `docker inspect .State.Health.Log` shows nothing but
 * the exit code and whatever the command printed. A probe that swallows its
 * error — `.catch(() => process.exit(1))` — leaves an empty Output, which is
 * indistinguishable from a missing binary, a failed exec, or a 500. That cost
 * real time once: supabase-studio sat unhealthy with five blank log entries.
 *
 * Two traps this pins:
 *
 *  1. Print the reason at all.
 *  2. Print `e.code`, not just `e.message`. Node's happy-eyeballs wraps a
 *     refused connection in an AggregateError whose `message` is the EMPTY
 *     STRING and whose `code` is ECONNREFUSED — so `console.error(e.message)`
 *     is just as blind as printing nothing.
 */

/** Every `node -e` probe body that ships in a compose file or Dockerfile. */
const PROBE_SOURCES = [
  'infra/docker-compose.prod.yml',
  'infra/docker-compose.dev.yml',
  'apps/api/Dockerfile',
  'apps/web-public/Dockerfile',
  'apps/web-staff/Dockerfile',
  'apps/web-admin/Dockerfile',
];

function extractProbes(text) {
  const probes = [];
  for (const line of text.split(/\r?\n/u)) {
    // Compose: the last element of the `test:` flow sequence, after 'node', '-e'.
    // `$$` is compose's escape for a literal `$`.
    const compose = /^\s*"(.*process\.exit.*)",?\s*$/u.exec(line);
    if (compose) probes.push(compose[1].replace(/\$\$/gu, '$'));
    // Dockerfile: HEALTHCHECK ... CMD node -e "..."
    const docker = /^\s*CMD node -e "(.*)"\s*$/u.exec(line);
    if (docker) probes.push(docker[1]);
  }
  return probes;
}

async function runProbe(code, env = {}) {
  try {
    const { stdout, stderr } = await run(process.execPath, ['-e', code], {
      env: { ...process.env, ...env },
    });
    return { exit: 0, out: `${stdout}${stderr}`.trim() };
  } catch (err) {
    return { exit: err.code, out: `${err.stdout ?? ''}${err.stderr ?? ''}`.trim() };
  }
}

function listen(status) {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(status);
      res.end('x');
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('every shipped healthcheck probe names its failure instead of exiting silently', async () => {
  let total = 0;
  for (const file of PROBE_SOURCES) {
    const probes = extractProbes(await readFile(path.join(ROOT, file), 'utf8'));
    assert.ok(probes.length > 0, `${file}: no node -e healthcheck probe found`);
    for (const code of probes) {
      total += 1;
      // Nothing is listening on any of these ports in a test run, so every
      // probe takes its connection-error path.
      const { exit, out } = await runProbe(code, { OPS_RUNNER_SECRET: 'test-secret' });
      assert.equal(exit, 1, `${file}: probe should exit 1 when the target is down\n${code}`);
      assert.match(
        out,
        /ECONNREFUSED/u,
        `${file}: probe must print the connection error, got ${JSON.stringify(out)}\n${code}`,
      );
    }
  }
  assert.ok(total >= 12, `expected every service probe to be covered, found ${total}`);
});

test('probes exit 0 on 200 and print the status code on a non-200', async () => {
  const prod = await readFile(path.join(ROOT, 'infra/docker-compose.prod.yml'), 'utf8');
  const probes = extractProbes(prod);
  // One of each shape: fetch-based (supabase-meta) and http.get-based (api).
  const fetchProbe = probes.find((p) => p.includes("fetch('http://localhost:8080/health')"));
  const getProbe = probes.find((p) => p.includes("get('http://localhost:4000/health'"));
  assert.ok(fetchProbe, 'supabase-meta fetch probe not found');
  assert.ok(getProbe, 'api http.get probe not found');

  const healthy = await listen(200);
  const broken = await listen(503);
  try {
    const okPort = healthy.address().port;
    const badPort = broken.address().port;
    for (const [probe, sourcePort] of [
      [fetchProbe, '8080'],
      [getProbe, '4000'],
    ]) {
      assert.deepEqual(await runProbe(probe.replace(sourcePort, String(okPort))), {
        exit: 0,
        out: '',
      });
      const failed = await runProbe(probe.replace(sourcePort, String(badPort)));
      assert.equal(failed.exit, 1);
      assert.match(failed.out, /503/u);
    }
  } finally {
    healthy.close();
    broken.close();
  }
});
