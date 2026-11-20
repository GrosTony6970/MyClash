/**
 * infra/scripts/lib/ops-jobs-wait.sh: deploy, redeploy and rollback wait for a running ops-runner
 * job before they move the checkout or touch the stack (ops agent slice 4b, ruling 898). A job
 * that started before .deploy.lock was taken would otherwise run beside the rebuild.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = join(REPO, 'infra/scripts');
const posix = (p) => p.replaceAll('\\', '/');
const LIB = posix(join(SCRIPTS, 'lib/ops-jobs-wait.sh'));
const LOG = posix(join(SCRIPTS, 'lib/log.sh'));
// Git Bash on Windows: System32's bash.exe is WSL, which cannot read a Windows PATH.
const BASH = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const skip = process.platform === 'win32' && !existsSync(BASH) ? 'needs Git Bash' : false;

/**
 * Runs the lib with `docker` and `timeout` stubbed as shell functions. `docker inspect` answers
 * `running` ('true', 'false' or '' for no such container). The probe's answers come one per exec
 * from a file; the last one repeats. `FAIL` makes the exec fail; `STRAY <line>` prints another
 * stdout line first. The count lives in a file: each call runs in a `$( … )` subshell.
 */
function runWait(answers, { waitS = 600, running = 'true' } = {}) {
  const dir = posix(mkdtempSync(join(tmpdir(), 'ops-wait-')));
  writeFileSync(join(dir, 'answers'), `${answers.join('\n')}\n`);
  writeFileSync(join(dir, 'count'), '0');
  const script = [
    'set -Eeuo pipefail',
    `source "${LOG}"`,
    `source "${LIB}"`,
    `timeout() { shift; "$@"; }`,
    'docker() {',
    `  echo "docker $*" >> "${dir}/calls"`,
    `  if [[ "$1" == inspect ]]; then [[ -n "${running}" ]] && echo "${running}"; return 0; fi`,
    `  local n; n=$(( $(cat "${dir}/count") + 1 )); echo "$n" > "${dir}/count"`,
    `  local total; total=$(wc -l < "${dir}/answers")`,
    `  (( n > total )) && n=$total`,
    `  local a; a=$(sed -n "\${n}p" "${dir}/answers")`,
    '  case "$a" in',
    '    FAIL) echo "Error: No such container" >&2; return 1 ;;',
    '    STRAY\\ *) echo "a stray line"; echo "${a#STRAY }" ;;',
    '    *) echo "$a" ;;',
    '  esac',
    '}',
    'mc_wait_for_ops_jobs',
    'echo "exit-ok"',
  ].join('\n');
  const env = { ...process.env, MC_OPS_WAIT_S: String(waitS), MC_OPS_POLL_S: '0.05' };
  const out = spawnSync(BASH, ['-c', script], { env, encoding: 'utf8' });
  const calls = existsSync(join(dir, 'calls'))
    ? readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n')
    : [];
  return { status: out.status, said: `${out.stdout}${out.stderr}`, calls };
}

test('a free lock goes on at once and says nothing', { skip }, () => {
  const r = runWait(['free']);
  assert.equal(r.status, 0, r.said);
  assert.match(r.said, /exit-ok/u);
  assert.doesNotMatch(r.said, /Waiting|Could not|No ops-runner/u);
  // The runner by its fixed name, the probe by its repo path: no COMPOSE, no .env.
  assert.deepEqual(r.calls, [
    'docker inspect -f {{.State.Running}} myclash-ops-runner',
    'docker exec myclash-ops-runner node infra/ops-runner/ops-lock-probe.mjs',
  ]);
});

test('a held lock is waited for, said once, then the deploy goes on', { skip }, () => {
  const r = runWait([
    'held backup 2026-11-20T01:00:00Z',
    'held backup 2026-11-20T01:00:00Z',
    'free',
  ]);
  assert.equal(r.status, 0, r.said);
  assert.equal(r.said.match(/Waiting for the ops runner's backup/gu)?.length, 1, r.said);
  assert.match(r.said, /since 2026-11-20T01:00:00Z/u);
  assert.equal(r.calls.filter((c) => c.startsWith('docker exec')).length, 3);
  assert.match(r.said, /exit-ok/u);
});

test('a lock still held past the wait stops the script, nothing changed', { skip }, () => {
  const r = runWait(['held container 2026-11-20T01:00:00Z'], { waitS: 1 });
  assert.equal(r.status, 1, r.said);
  assert.doesNotMatch(r.said, /exit-ok/u);
  assert.match(
    r.said,
    /The ops runner's container still holds its lock after 1 s\. Nothing was changed\./u,
  );
});

test('a runner that is stopped, or absent, holds nothing, and is not asked', { skip }, () => {
  for (const running of ['false', '']) {
    const r = runWait(['held backup x'], { running, waitS: 1 });
    assert.equal(r.status, 0, r.said);
    assert.match(r.said, /No ops-runner job to wait for: the runner is not running\./u);
    assert.match(r.said, /exit-ok/u);
    assert.equal(r.calls.filter((c) => c.startsWith('docker exec')).length, 0, running);
  }
});

// Final review of slice 4b, M3: a running runner whose answer fails (a 30 s timeout, a crash) is
// not "not running"; it is said with the exit code, and the deploy goes on.
test('a running runner that fails to answer is said with its exit code', { skip }, () => {
  const r = runWait(['FAIL']);
  assert.equal(r.status, 0, r.said);
  assert.doesNotMatch(r.said, /the runner is not running/u);
  assert.match(r.said, /Could not ask the ops runner about its jobs \(exit 1\); going on\./u);
});

test('an old runner without the route is said, and does not block', { skip }, () => {
  const r = runWait(['unknown status-404']);
  assert.equal(r.status, 0, r.said);
  assert.match(
    r.said,
    /Could not ask the ops runner about its jobs \(unknown status-404\); going on\./u,
  );
});

test('only the last stdout line is the answer', { skip }, () => {
  const r = runWait(['STRAY free']);
  assert.equal(r.status, 0, r.said);
  assert.doesNotMatch(r.said, /Could not ask|Waiting/u, r.said);
});

const read = (name) => readFileSync(join(SCRIPTS, name), 'utf8');
const lineOf = (text, needle) => text.split('\n').findIndex((l) => l.includes(needle));

for (const [script, lock, moves] of [
  ['deploy.sh', 'mc_lock_deploy "$LOCK_FILE"', 'mc_pull_then_reexec "$SCRIPT_DIR/deploy.sh"'],
  ['redeploy.sh', 'mc_lock_deploy "$LOCK_FILE"', 'mc_pull_then_reexec "$SCRIPT_DIR/redeploy.sh"'],
  ['rollback.sh', 'if ! flock -n 9; then', 'git reset --hard "$PREV_COMMIT"'],
]) {
  test(`${script} waits after its lock, before COMPOSE exists and before the checkout moves`, () => {
    const text = read(script);
    const source = lineOf(text, 'source "$SCRIPT_DIR/lib/ops-jobs-wait.sh"');
    const call = text.split('\n').findIndex((l) => /^\s*mc_wait_for_ops_jobs$/u.test(l));
    const locked = lineOf(text, lock);
    const compose = lineOf(text, 'mc_compose_init');
    const moved = lineOf(text, moves);
    assert.ok(source >= 0 && call > source, 'the lib is sourced, then called');
    assert.ok(locked >= 0 && call > locked, 'after the deploy lock');
    assert.ok(compose > call, 'before the COMPOSE array exists: no compose call comes first');
    assert.ok(moved > call, 'before the checkout moves');
  });
}
