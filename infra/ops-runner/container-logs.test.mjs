import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_LOG_SERVICES } from '../../apps/api/src/modules/ops-agent/agent-log-services.ts';
import {
  LOG_EXCLUDED,
  LOG_LINE_MAX_CHARS,
  LOG_SERVICES,
  PROBLEM_LINE,
  boundLogLines,
  parseLogQuery,
  projectComposePs,
  readContainerLog,
  readContainers,
} from './container-logs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FLAGS = ['--env-file', '/srv/myclash/.env', '-f', 'infra/docker-compose.prod.yml'];

/** A `run` double: answers `answer`, records each argv. */
function fakeRun(answer = { code: 0, stdout: '', stderr: '', timedOut: false }) {
  const calls = [];
  const run = async (command, args, timeoutMs) => {
    calls.push({ command, args, timeoutMs });
    return answer;
  };
  return { run, calls };
}

const url = (query = '') => new URL(`http://ops-runner/logs/x${query}`);

// `docker compose ps --all --format json`: one object per line (Compose v2.21+).
const PS_RUNNING = JSON.stringify({
  Name: 'myclash-api',
  Service: 'api',
  State: 'running',
  Health: 'healthy',
  Status: 'Up 6 hours (healthy)',
  ExitCode: 0,
  Labels: 'com.docker.compose.project=myclash',
  Command: '"docker-entrypoint.s…"',
  Publishers: [{ URL: '', TargetPort: 4000 }],
});
const PS_EXITED = JSON.stringify({
  Name: 'myclash-worker',
  Service: 'worker',
  State: 'exited',
  Health: '',
  Status: 'Exited (137) 2 minutes ago',
  ExitCode: 137,
  Labels: 'x',
});

test('projectComposePs keeps six fields by name, and sorts by service', () => {
  const rows = projectComposePs(`${PS_RUNNING}\n${PS_EXITED}\n`);
  assert.deepEqual(rows, [
    {
      name: 'myclash-api',
      service: 'api',
      state: 'running',
      health: 'healthy',
      status: 'Up 6 hours (healthy)',
      exitCode: 0,
    },
    {
      name: 'myclash-worker',
      service: 'worker',
      state: 'exited',
      health: null,
      status: 'Exited (137) 2 minutes ago',
      exitCode: 137,
    },
  ]);
  assert.ok(!JSON.stringify(rows).includes('Labels'));
});

test('projectComposePs refuses a line that is not JSON', () => {
  assert.throws(() => projectComposePs('NAME IMAGE STATUS\n'));
});

test('readContainers asks compose for every container, stopped ones included', async () => {
  const { run, calls } = fakeRun({ code: 0, stdout: `${PS_RUNNING}\n`, stderr: '' });
  const answer = await readContainers(run, FLAGS);
  assert.deepEqual(calls[0].args, ['compose', ...FLAGS, 'ps', '--all', '--format', 'json']);
  assert.equal(calls[0].command, 'docker');
  assert.equal(answer.containers.length, 1);
  assert.equal(typeof answer.generatedAt, 'string');
});

test('readContainerLog refuses db, meta and anything off the list, before running docker', async () => {
  for (const service of ['db', 'supabase-meta', 'DB', '../db', '', 'web-public ']) {
    const { run, calls } = fakeRun();
    await assert.rejects(readContainerLog(run, FLAGS, service, url()), (error) => {
      assert.equal(error.statusCode, 403);
      assert.equal(error.code, 'service_not_allowed');
      return true;
    });
    assert.equal(calls.length, 0, service);
  }
});

test('readContainerLog asks for the last N lines of one service', async () => {
  const { run, calls } = fakeRun({ code: 0, stdout: 'a\nb\n', stderr: '' });
  const answer = await readContainerLog(run, FLAGS, 'api', url('?lines=50'));
  assert.deepEqual(calls[0].args, [
    'compose',
    ...FLAGS,
    'logs',
    '--no-color',
    '--no-log-prefix',
    '--timestamps',
    '--tail',
    '50',
    'api',
  ]);
  assert.deepEqual(answer.lines, ['a', 'b']);
  assert.equal(answer.service, 'api');
  assert.equal(answer.truncated, false);
});

test('the errors-only read scans 2000 lines and keeps the last N problem lines', async () => {
  const stdout = [
    't1 {"level":50,"msg":"boom"}',
    't2 {"level":30,"msg":"fine"}',
    't3 WARN [AuthGuard] would-401',
    't4 plain line',
    't5 {"level":40,"msg":"slow"}',
    't6 Error: ECONNREFUSED',
  ].join('\n');
  const { run, calls } = fakeRun({ code: 0, stdout, stderr: '' });
  const answer = await readContainerLog(run, FLAGS, 'api', url('?errors=1&lines=3'));
  assert.equal(calls[0].args.at(-2), '2000');
  assert.deepEqual(answer.lines, [
    't3 WARN [AuthGuard] would-401',
    't5 {"level":40,"msg":"slow"}',
    't6 Error: ECONNREFUSED',
  ]);
});

test('parseLogQuery refuses a line count out of range', () => {
  for (const lines of ['0', '501', 'abc', '2.5', '-1']) {
    assert.throws(
      () => parseLogQuery(url(`?lines=${lines}`)),
      (error) => error.statusCode === 400,
      lines,
    );
  }
  assert.deepEqual(parseLogQuery(url()), { lines: 100, errorsOnly: false });
  assert.deepEqual(parseLogQuery(url('?lines=500&errors=true')), {
    lines: 500,
    errorsOnly: true,
  });
});

test('a long line is cut, and the cut never leaves half an address', () => {
  const long = 'x'.repeat(5000);
  const one = boundLogLines(long, { lines: 10, errorsOnly: false });
  assert.ok(one.lines[0].length <= LOG_LINE_MAX_CHARS + '…[cut]'.length);
  assert.ok(one.lines[0].endsWith('…[cut]'));
  assert.equal(one.truncated, true);

  // The 2000th character falls inside the address.
  const line = `${'a '.repeat(990)}sent to jean.dupont@example.com and more`;
  const cut = boundLogLines(line, { lines: 10, errorsOnly: false }).lines[0];
  assert.ok(!cut.includes('jean'), cut.slice(-40));
  assert.ok(!cut.includes('@'), cut.slice(-40));
});

test('the whole answer stays under its size cap, newest lines kept', () => {
  const stdout = Array.from({ length: 500 }, (_, i) => `${i} ${'y'.repeat(995)}`).join('\n');
  const { lines, truncated } = boundLogLines(stdout, { lines: 500, errorsOnly: false });
  const total = lines.reduce((sum, l) => sum + l.length, 0);
  assert.ok(total <= 262144, String(total));
  assert.equal(truncated, true);
  assert.ok(lines.at(-1).startsWith('499 '));
});

test('a stopped container answers no lines, not an error', async () => {
  const { run } = fakeRun({ code: 0, stdout: '', stderr: '' });
  const answer = await readContainerLog(run, FLAGS, 'worker', url());
  assert.deepEqual(answer.lines, []);
  assert.equal(answer.truncated, false);
});

test('a timeout or a failed docker call throws a fixed text, never stderr', async () => {
  for (const answer of [
    { code: null, stdout: '', stderr: 'secret-ish stderr', timedOut: true },
    { code: 1, stdout: '', stderr: 'secret-ish stderr', timedOut: false },
  ]) {
    const { run } = fakeRun(answer);
    await assert.rejects(readContainerLog(run, FLAGS, 'api', url()), (error) => {
      assert.ok(!error.message.includes('secret-ish'));
      assert.equal(error.statusCode, undefined);
      return true;
    });
  }
});

test("the problem-line filter is status.sh's, word for word", () => {
  const statusSh = readFileSync(path.join(ROOT, 'infra/scripts/status.sh'), 'utf8');
  const filter = statusSh.slice(statusSh.indexOf('errors_only_filter() {'));
  assert.ok(filter.slice(0, 300).includes(PROBLEM_LINE.source), PROBLEM_LINE.source);
});

test('the API reads the same list as the runner', () => {
  assert.deepEqual([...AGENT_LOG_SERVICES].sort(), [...LOG_SERVICES].sort());
});

test('every compose service is either on the list or left out by name', () => {
  const compose = readFileSync(path.join(ROOT, 'infra/docker-compose.prod.yml'), 'utf8');
  const services = compose.slice(0, compose.indexOf('\nnetworks:'));
  const names = [...services.matchAll(/^ {2}([a-z-]+):$/gm)].map((m) => m[1]);
  assert.ok(names.length >= 16, String(names.length));
  for (const name of LOG_EXCLUDED) assert.ok(!LOG_SERVICES.has(name), name);
  assert.deepEqual(names.sort(), [...LOG_SERVICES, ...LOG_EXCLUDED].sort());
});
