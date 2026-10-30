/**
 * infra/scripts/restore.sh run against stubs of `docker`, `gpg` and `gunzip` that record their
 * arguments (the text pins are in restore-script-guard.test.mjs).
 *
 * The script and its libs are copied into a temporary root with a fake `.env`: the script `cd`s
 * two levels above itself. The `docker` stub reads its stdin to the end — `set -o pipefail` would
 * otherwise see gunzip die of SIGPIPE — and answers the validation queries as a good restore would.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Git Bash on Windows: System32's bash.exe is WSL, which cannot read a Windows PATH.
const BASH = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const skip = process.platform === 'win32' && !existsSync(BASH) ? 'needs Git Bash' : false;

const NIGHT = '20261030T030000Z';
const NIGHTLY_DB = `backups/nightly/db-${NIGHT}.sql.gz`;
const NIGHTLY_STORAGE = `backups/nightly/storage-${NIGHT}.tar.gz`;

const DOCKER = `#!/usr/bin/env bash
echo "docker $*" >> "$CALL_LOG"
cat > /dev/null
case "$*" in
  *"volume inspect"*) exit "\${VOLUME_INSPECT_EXIT:-0}" ;;
  *information_schema.schemata*) echo 1 ;;
  *information_schema.tables*) echo 42 ;;
  *auth.users*) echo 3 ;;
esac
exit 0
`;
const GUNZIP = `#!/usr/bin/env bash
echo "gunzip $*" >> "$CALL_LOG"
if [[ "$1" == "-t" ]]; then exit "\${GUNZIP_TEST_EXIT:-0}"; fi
if [[ "$1" == "-c" ]]; then cat "$2"; fi
exit 0
`;
const GPG = `#!/usr/bin/env bash
echo "gpg $*" >> "$CALL_LOG"
out=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) out="$2"; shift 2 ;;
    *) in="$1"; shift ;;
  esac
done
cp "$in" "$out"
`;

const roots = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'restore-sh-'));
  roots.push(root);
  const scripts = join(root, 'infra', 'scripts');
  mkdirSync(join(scripts, 'lib'), { recursive: true });
  copyFileSync(join(REPO, 'infra/scripts/restore.sh'), join(scripts, 'restore.sh'));
  for (const lib of readdirSync(join(REPO, 'infra/scripts/lib'))) {
    copyFileSync(join(REPO, 'infra/scripts/lib', lib), join(scripts, 'lib', lib));
  }
  writeFileSync(join(root, '.env'), 'POSTGRES_USER=postgres\nPOSTGRES_DB=myclash\n');
  mkdirSync(join(root, 'bin'));
  for (const [name, body] of [
    ['docker', DOCKER],
    ['gunzip', GUNZIP],
    ['gpg', GPG],
  ]) {
    writeFileSync(join(root, 'bin', name), body, { mode: 0o755 });
  }
  mkdirSync(join(root, 'backups', 'nightly'), { recursive: true });
  return root;
}

function put(root, file) {
  writeFileSync(join(root, file), 'archive');
  return file;
}

function restore(root, args, extraEnv = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^path$/iu.test(key) && key !== 'MYCLASH_RESTORE_CONFIRM',
    ),
  );
  const inheritedPath =
    Object.entries(process.env).find(([key]) => /^path$/iu.test(key))?.[1] ?? '';
  const log = join(root, 'calls.log').replaceAll('\\', '/');
  // Git Bash's bash.exe puts /usr/bin (a real gunzip and gpg) ahead of the PATH it is given, so
  // the stubs go first from inside bash; `cd … && pwd` turns C:/… into the path bash reads.
  const result = spawnSync(
    BASH,
    [
      '-c',
      'PATH="$(cd "$STUB_BIN" && pwd):$PATH" exec bash "$0" "$@"',
      join(root, 'infra/scripts/restore.sh').replaceAll('\\', '/'),
      ...args,
    ],
    {
      cwd: root,
      env: {
        ...env,
        ...extraEnv,
        PATH: inheritedPath,
        STUB_BIN: join(root, 'bin').replaceAll('\\', '/'),
        CALL_LOG: log,
      },
      input: '',
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
  const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  return { status: result.status, output: `${result.stdout}${result.stderr}`, calls };
}

const show = (run) => `${run.output}\ncalls:\n${run.calls.join('\n')}`;
const volumeRun = (call) => call.startsWith('docker run --rm -i -v myclash-storage-data:/vol');

// The EXIT trap's last command sets the script's status: a cleanup that found no decrypted file
// to remove made every restore without an encrypted images file exit 1 — "failed" on the screen.
test('a restore that worked exits 0: the database and the night’s images', { skip }, () => {
  const root = sandbox();
  put(root, NIGHTLY_STORAGE);
  const run = restore(root, [put(root, NIGHTLY_DB), '--yes']);
  assert.equal(run.status, 0, show(run));
  assert.ok(
    run.calls.some((call) => call.includes('DROP DATABASE')),
    show(run),
  );
  assert.ok(run.calls.includes(`gunzip -c ${NIGHTLY_STORAGE}`), show(run));
  assert.ok(run.calls.some(volumeRun), show(run));
  assert.match(run.calls.at(-1) ?? '', / up -d$/u, show(run));
});

test('a restore that worked exits 0: --db-only leaves the images', { skip }, () => {
  const root = sandbox();
  put(root, NIGHTLY_STORAGE);
  const run = restore(root, [put(root, NIGHTLY_DB), '--yes', '--db-only']);
  assert.equal(run.status, 0, show(run));
  assert.ok(
    run.calls.some((call) => call.includes('DROP DATABASE')),
    show(run),
  );
  assert.ok(!run.calls.some(volumeRun), show(run));
});

test('a restore that failed still exits non-zero', { skip }, () => {
  const root = sandbox();
  put(root, NIGHTLY_STORAGE);
  const broken = restore(root, [put(root, NIGHTLY_DB), '--yes'], { GUNZIP_TEST_EXIT: '1' });
  assert.notEqual(broken.status, 0, show(broken));
  assert.ok(!broken.calls.some((call) => call.startsWith('docker')), show(broken));
  const noVolume = restore(root, [NIGHTLY_DB, '--yes'], { VOLUME_INSPECT_EXIT: '1' });
  assert.equal(noVolume.status, 1, show(noVolume));
});
