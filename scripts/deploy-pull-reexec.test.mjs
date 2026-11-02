/**
 * infra/scripts/lib/pull-reexec.sh against real git and flock (ruling 400).
 *
 * A sandbox holds a bare "origin" and a "server" clone of it. The server's checkout runs an
 * entrypoint shaped like deploy.sh: take the lock, pull, then the rest. Origin then gets a
 * commit that changes the entrypoint and the ".env repair" it runs. The run must finish on the
 * NEW code, with its original arguments, holding the lock it took before the pull.
 *
 * Linux only: Git Bash on Windows has no flock. CI runs it.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hasFlock = spawnSync('bash', ['-c', 'command -v flock'], { encoding: 'utf8' }).status === 0;
// Skipped only on Windows. A Linux CI runner without flock must fail, not skip in silence.
if (process.platform !== 'win32' && !hasFlock && process.env['CI']) {
  throw new Error('deploy-pull-reexec.test.mjs needs flock on the CI runner (util-linux).');
}
const skip = process.platform === 'win32' || !hasFlock ? 'needs bash with flock (Linux)' : false;
const TIMEOUT = 30_000; // a helper that re-execs forever must fail the test, not hang CI

const roots = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

// The entrypoint, as each commit ships it. `version` is what a run of that commit prints.
function entrypoint(version) {
  return `#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"
source "$SCRIPT_DIR/lib/pull-reexec.sh"
ORIG_ARGS=("$@")
LOCK_FILE="$ROOT_DIR/.deploy.lock"
mc_lock_deploy "$LOCK_FILE" "Another deploy is already running."
# A first-run marker in the lock file: a re-run that reopened fd 9 would truncate it.
[[ -z "\${MC_PULLED_FROM:-}" ]] && echo first-run >&9
trap 'rm -f "$LOCK_FILE"' EXIT
mc_pull_then_reexec "$SCRIPT_DIR/entry.sh" "\${ORIG_ARGS[@]}"
echo "ENTRY=${version}"
echo "REPAIR=$(bash repair.sh)"
echo "ARGS=$*"
echo "PRE=$PRE_PULL_COMMIT PULLED=$PULLED_COMMIT"
echo "MARKER=$(cat "$LOCK_FILE")"
if flock -n "$LOCK_FILE" true; then echo LOCK=free; else echo LOCK=held; fi
`;
}

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: TIMEOUT });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function writeCommit(dir, version, message) {
  writeFileSync(join(dir, 'infra/scripts/entry.sh'), entrypoint(version), { mode: 0o755 });
  writeFileSync(join(dir, 'repair.sh'), `echo repair-${version}\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'pull-reexec-'));
  roots.push(root);
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, work);
  for (const dir of [work]) {
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'test');
  }
  mkdirSync(join(work, 'infra/scripts/lib'), { recursive: true });
  for (const lib of ['log.sh', 'pull-reexec.sh']) {
    copyFileSync(join(REPO, 'infra/scripts/lib', lib), join(work, 'infra/scripts/lib', lib));
  }
  const old = writeCommit(work, 'v1', 'old');
  git(work, 'push', '-q', 'origin', 'HEAD:main');
  const server = join(root, 'server');
  git(root, 'clone', '-q', origin, server);
  return { work, server, old };
}

function run(server, ...args) {
  const r = spawnSync('bash', [join(server, 'infra/scripts/entry.sh'), ...args], {
    cwd: server,
    encoding: 'utf8',
    timeout: TIMEOUT,
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

test('a pull re-runs the NEW entrypoint with its arguments and the lock held', { skip }, () => {
  const { work, server, old } = sandbox();
  const next = writeCommit(work, 'v2', 'new');
  git(work, 'push', '-q', 'origin', 'HEAD:main');

  const r = run(server, '--skip-backup', 'two words');
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /^ENTRY=v2$/m, 'the rest of the run is the new entrypoint');
  assert.match(r.out, /^REPAIR=repair-v2$/m, 'the .env repair is the new one');
  assert.doesNotMatch(r.out, /^ENTRY=v1$/m, 'the old entrypoint never runs its tail');
  assert.match(r.out, /^ARGS=--skip-backup two words$/m);
  assert.match(r.out, new RegExp(`^PRE=${old} PULLED=${next}$`, 'm'));
  assert.match(r.out, /^MARKER=first-run$/m, 'the re-run kept the first run’s lock file open');
  assert.match(r.out, /^LOCK=held$/m, 'another process cannot take the lock during the re-run');
  assert.equal(git(server, 'rev-parse', 'HEAD'), next);
});

test('a new commit without the entrypoint stops and says how to go back', { skip }, () => {
  const { work, server, old } = sandbox();
  git(work, 'rm', '-q', 'infra/scripts/entry.sh');
  git(work, 'commit', '-q', '-m', 'entrypoint renamed');
  const next = git(work, 'rev-parse', 'HEAD');
  git(work, 'push', '-q', 'origin', 'HEAD:main');

  const r = run(server);
  assert.equal(r.status, 1, r.out + r.err);
  assert.match(r.err, new RegExp(`To go back: git reset --hard ${old}`));
  assert.doesNotMatch(r.out, /^ENTRY=/m, 'nothing after the pull runs');
  assert.equal(git(server, 'rev-parse', 'HEAD'), next);
});

test('no new commit: one run, no re-run', { skip }, () => {
  const { server, old } = sandbox();
  const r = run(server, '--x');
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out.match(/^ENTRY=/gm)?.length, 1);
  assert.match(r.out, /^ENTRY=v1$/m);
  assert.match(r.out, new RegExp(`^PRE=${old} PULLED=${old}$`, 'm'));
  assert.match(r.out, /No new commits/);
});

test('a second run is refused while the lock is held', { skip }, () => {
  const { server } = sandbox();
  const lock = join(server, '.deploy.lock');
  // The holder keeps the lock on its own fd 8 and stays alive (a trailing command stops
  // `bash -c` from exec-ing into the entrypoint) while a second run starts.
  const holder = spawnSync(
    'bash',
    [
      '-c',
      `exec 8>"${lock}"; flock -n 8 || exit 9; bash "${join(server, 'infra/scripts/entry.sh')}"; echo "rc=$?"`,
    ],
    { cwd: server, encoding: 'utf8', timeout: TIMEOUT },
  );
  assert.match(holder.stdout, /^rc=1$/m, holder.stdout + holder.stderr);
  assert.match(holder.stderr, /Another deploy is already running/);
  assert.doesNotMatch(holder.stdout, /^ENTRY=/m);
});
