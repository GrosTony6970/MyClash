/**
 * infra/scripts/lib/ops-agent-wake.sh: deploy.sh and redeploy.sh start the ops agent's cloud task
 * at their end, with run type `deploy` (ops agent slice 6, rulings 906-908). The call never fails
 * the deploy: the box of newly generated credentials prints after it (deploy.sh,
 * print_deployment_secrets). The token and the fire URL go to curl on stdin, never as an argument:
 * every user of the host reads a process's arguments (ruling 425).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = join(REPO, 'infra/scripts');
const posix = (p) => p.replaceAll('\\', '/');
const LIB = posix(join(SCRIPTS, 'lib/ops-agent-wake.sh'));
const LOG = posix(join(SCRIPTS, 'lib/log.sh'));
// Git Bash on Windows: System32's bash.exe is WSL, which cannot read a Windows PATH.
const BASH = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const skip = process.platform === 'win32' && !existsSync(BASH) ? 'needs Git Bash' : false;

const URL = 'https://api.example.test/v1/claude_code/routines/trig_x/fire';
const TOKEN = 'tok-SECRET_0.9~x+y/z=';
const COMMIT = '0123456789abcdef0123456789abcdef01234567';

/**
 * Runs the lib under the deploy scripts' own strictness, `curl` stubbed as a shell function that
 * records its arguments (one per line) and its stdin, then prints `code` or returns `exitCode`.
 * `env` replaces the two keys: a key given `undefined` is UNSET, not empty.
 */
function runWake(
  args,
  {
    env = { OPS_AGENT_WAKE_URL: URL, OPS_AGENT_WAKE_TOKEN: TOKEN },
    code = '200',
    exitCode = 0,
    realCurl = false,
  } = {},
) {
  const dir = posix(mkdtempSync(join(tmpdir(), 'ops-wake-')));
  const stub = [
    'curl() {',
    `  printf '%s\\n' "$@" > "${dir}/args"`,
    `  cat > "${dir}/stdin"`,
    `  echo call >> "${dir}/calls"`,
    `  if [[ ${exitCode} -ne 0 ]]; then return ${exitCode}; fi`,
    `  printf '%s' '${code}'`,
    '}',
  ];
  const script = [
    'set -Eeuo pipefail',
    `source "${LOG}"`,
    `source "${LIB}"`,
    ...(realCurl ? [] : stub),
    `mc_wake_ops_agent_after_deploy ${args}`,
    'echo next-ok',
  ].join('\n');
  const base = { ...process.env };
  delete base.OPS_AGENT_WAKE_URL;
  delete base.OPS_AGENT_WAKE_TOKEN;
  for (const [key, value] of Object.entries(env)) if (value !== undefined) base[key] = value;
  const out = spawnSync(BASH, ['-c', script], { env: base, encoding: 'utf8' });
  const read = (name) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : '');
  return {
    status: out.status,
    said: `${out.stdout}${out.stderr}`,
    calls: read('calls').split('\n').filter(Boolean).length,
    argv: read('args').split('\n').slice(0, -1),
    stdin: read('stdin'),
  };
}

/** Every case: the caller's next line runs, and the script exits 0. */
function assertNeverFails(r) {
  assert.equal(r.status, 0, r.said);
  assert.match(r.said, /next-ok/u);
}

const body = (text) => JSON.stringify({ text });

test('a configured deploy calls once, the token and URL on stdin only', { skip }, () => {
  const r = runWake(`deploy ${COMMIT}`);
  assertNeverFails(r);
  assert.equal(r.calls, 1);
  assert.deepEqual(r.argv, [
    '-q',
    '--config',
    '-',
    '--proto',
    '=https',
    '--globoff',
    '--silent',
    '--max-time',
    '15',
    '--output',
    '/dev/null',
    '--write-out',
    '%{http_code}',
    '--request',
    'POST',
    '--data-raw',
    body(`deploy commit=${COMMIT} kind=deploy`),
  ]);
  assert.equal(
    r.stdin,
    [
      `url = "${URL}"`,
      `header = "Authorization: Bearer ${TOKEN}"`,
      'header = "anthropic-version: 2023-06-01"',
      'header = "anthropic-beta: experimental-cc-routine-2026-04-01"',
      'header = "Content-Type: application/json"',
      '',
    ].join('\n'),
  );
  for (const arg of r.argv) {
    assert.ok(!arg.includes(TOKEN) && !arg.includes(URL), `no secret in ${arg}`);
  }
  assert.match(r.said, /agent: deploy check started \(200\)/u);
});

test('a redeploy names its services; a service of another shape is left out', { skip }, () => {
  const r = runWake(`redeploy ${COMMIT} api worker 'Bad;x'`);
  assertNeverFails(r);
  assert.equal(r.argv.at(-1), body(`deploy commit=${COMMIT} kind=redeploy services=api,worker`));
});

test('a commit that is not 40 hex characters is sent as unknown', { skip }, () => {
  const r = runWake('deploy not-a-commit');
  assertNeverFails(r);
  assert.equal(r.argv.at(-1), body('deploy commit=unknown kind=deploy'));
});

test('a refused call warns and the deploy goes on', { skip }, () => {
  const r = runWake(`deploy ${COMMIT}`, { code: '401' });
  assertNeverFails(r);
  assert.match(r.said, /agent: the deploy wake-up answered 401; no deploy check this time/u);
});

test('a call that fails warns with curl exit code and the deploy goes on', { skip }, () => {
  const r = runWake(`deploy ${COMMIT}`, { exitCode: 7 });
  assertNeverFails(r);
  assert.match(
    r.said,
    /agent: the deploy wake-up failed \(curl exit 7\); no deploy check this time/u,
  );
});

// Slice 6 review M5: the stub takes any input; the real curl must parse the config and keep the
// URL whole. A port that refuses on the loopback answers exit 7 ("could not connect"), never a
// parse error (2, 26) or a bad URL glob (3): `[` unclosed is a glob error without --globoff.
const noCurl = spawnSync('curl', ['--version']).status !== 0 ? 'needs curl' : false;
test('the real curl reads the config and the URL as written', { skip: skip || noCurl }, () => {
  const r = runWake(`deploy ${COMMIT}`, {
    env: { OPS_AGENT_WAKE_URL: 'https://127.0.0.1:9/fire[x', OPS_AGENT_WAKE_TOKEN: TOKEN },
    realCurl: true,
  });
  assertNeverFails(r);
  assert.match(r.said, /agent: the deploy wake-up failed \(curl exit 7\)/u);
});

test('keys unset or empty: not configured, no call', { skip }, () => {
  for (const env of [
    { OPS_AGENT_WAKE_URL: undefined, OPS_AGENT_WAKE_TOKEN: undefined },
    { OPS_AGENT_WAKE_URL: '', OPS_AGENT_WAKE_TOKEN: '' },
  ]) {
    const r = runWake(`deploy ${COMMIT}`, { env });
    assertNeverFails(r);
    assert.equal(r.calls, 0);
    assert.match(r.said, /agent: deploy wake-up not configured/u);
  }
});

test(
  'one key missing, an http URL or a token curl would have to unquote: no call',
  { skip },
  () => {
    for (const env of [
      { OPS_AGENT_WAKE_URL: URL, OPS_AGENT_WAKE_TOKEN: undefined },
      { OPS_AGENT_WAKE_URL: '', OPS_AGENT_WAKE_TOKEN: TOKEN },
      { OPS_AGENT_WAKE_URL: 'http://api.example.test/fire', OPS_AGENT_WAKE_TOKEN: TOKEN },
      { OPS_AGENT_WAKE_URL: URL, OPS_AGENT_WAKE_TOKEN: 'tok"x' },
      { OPS_AGENT_WAKE_URL: `${URL}" -k "`, OPS_AGENT_WAKE_TOKEN: TOKEN },
    ]) {
      const r = runWake(`deploy ${COMMIT}`, { env });
      assertNeverFails(r);
      assert.equal(r.calls, 0, JSON.stringify(env));
      assert.match(r.said, /agent: deploy wake-up misconfigured/u);
    }
  },
);

const read = (name) => readFileSync(join(SCRIPTS, name), 'utf8');
const lines = (name) => read(name).split('\n');
const indexOf = (all, re) => all.findIndex((l) => re.test(l));
const lastIndexOf = (all, re) => all.findLastIndex((l) => re.test(l));

test('deploy.sh wakes the agent after its summary, before the secrets box', () => {
  const all = lines('deploy.sh');
  const source = indexOf(all, /^source "\$SCRIPT_DIR\/lib\/ops-agent-wake\.sh"$/u);
  const call = indexOf(all, /^mc_wake_ops_agent_after_deploy deploy "\$NEW_COMMIT"$/u);
  const summary = indexOf(all, /^hdr "Deploy complete"$/u);
  const secrets = lastIndexOf(all, /^print_deployment_secrets$/u);
  assert.ok(source >= 0 && call > source, 'the lib is sourced, then called');
  assert.ok(call > summary, 'after the summary');
  assert.ok(secrets > call, 'before the secrets box, which stays last on screen');
});

test('redeploy.sh wakes the agent at its end, with its services', () => {
  const all = lines('redeploy.sh');
  const source = indexOf(all, /^source "\$SCRIPT_DIR\/lib\/ops-agent-wake\.sh"$/u);
  const call = indexOf(
    all,
    /^mc_wake_ops_agent_after_deploy redeploy "\$GIT_COMMIT" "\$\{SERVICES\[@\]\}"$/u,
  );
  const done = indexOf(all, /^ok "Redeployed: /u);
  assert.ok(source >= 0 && call > source, 'the lib is sourced, then called');
  assert.ok(call > done, 'after the redeploy is done');
});

test('no other script wakes the agent (ruling 906), and no curl names the token', () => {
  for (const name of ['rollback.sh', 'restore.sh', 'start.sh', 'refresh.sh', 'stop.sh']) {
    assert.doesNotMatch(read(name), /mc_wake_ops_agent_after_deploy/u, name);
  }
  for (const name of ['deploy.sh', 'redeploy.sh', 'lib/ops-agent-wake.sh']) {
    for (const line of lines(name).filter((l) => /\bcurl\b/u.test(l))) {
      assert.doesNotMatch(line, /OPS_AGENT_WAKE_(TOKEN|URL)/u, `${name}: ${line}`);
    }
  }
});
