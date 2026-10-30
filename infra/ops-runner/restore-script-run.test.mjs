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
const DB = `backups/uploads/${NIGHT}/db-${NIGHT}.sql.gz`;
const STORAGE = `backups/uploads/${NIGHT}/storage-${NIGHT}.tar.gz`;

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
// Every plain object is in the bucket; `s3 cp <from> <to>` writes <to>.
const AWS = `#!/usr/bin/env bash
echo "aws $*" >> "$CALL_LOG"
if [[ "$1 $2" == "s3 cp" ]]; then echo archive > "$4"; fi
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
    ['aws', AWS],
  ]) {
    writeFileSync(join(root, 'bin', name), body, { mode: 0o755 });
  }
  mkdirSync(join(root, 'backups', 'nightly'), { recursive: true });
  mkdirSync(join(root, 'backups', 'uploads', NIGHT), { recursive: true });
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

const BUCKET = {
  BACKUP_SCW_ACCESS_KEY: 'key',
  BACKUP_SCW_SECRET_KEY: 'secret',
  BACKUP_SCW_BUCKET: 'bucket',
  BACKUP_SCW_ENDPOINT: 'https://s3.example',
};
const show = (run) => `${run.output}\ncalls:\n${run.calls.join('\n')}`;
const volumeRun = (call) => call.startsWith('docker run --rm -i -v myclash-storage-data:/vol');
const stops = (run) => run.calls.filter((call) => / stop( |$)/u.test(call));

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

// An uploaded night (ruling 209): its images are not in backups/nightly, so they are named.
test('--storage-file restores the database with the images of the given file', { skip }, () => {
  const root = sandbox();
  put(root, NIGHTLY_STORAGE);
  const run = restore(root, [put(root, DB), '--yes', '--storage-file', put(root, STORAGE)]);
  assert.equal(run.status, 0, show(run));
  assert.ok(
    run.calls.some((call) => call.includes('DROP DATABASE')),
    show(run),
  );
  assert.ok(run.calls.includes(`gunzip -t ${STORAGE}`), show(run));
  assert.ok(run.calls.includes(`gunzip -c ${STORAGE}`), show(run));
  assert.ok(!run.calls.some((call) => call.includes(NIGHTLY_STORAGE)), show(run));
  assert.match(stops(run)[0] ?? '', /supabase-auth/u, show(run));
  assert.match(run.calls.at(-1) ?? '', / up -d$/u, show(run));
});

// Ruling 215: only the images of a night were uploaded.
test('--storage-only replaces the images and never touches the database', { skip }, () => {
  const root = sandbox();
  const run = restore(root, ['--storage-only', put(root, STORAGE), '--yes']);
  assert.equal(run.status, 0, show(run));
  assert.ok(!run.calls.some((call) => /psql|DROP/u.test(call)), show(run));
  assert.deepEqual(
    stops(run).map((call) => call.split(' stop ')[1]),
    ['supabase-storage'],
    show(run),
  );
  assert.ok(run.calls.some(volumeRun), show(run));
  assert.ok(run.calls.includes(`gunzip -c ${STORAGE}`), show(run));
  assert.match(run.calls.at(-1) ?? '', / up -d --no-deps supabase-storage$/u, show(run));
  assert.match(run.output, /database is not touched/iu);
});

test('a failed --storage-only on a .gpg leaves no decrypted file behind', { skip }, () => {
  const root = sandbox();
  const sealed = put(root, `${STORAGE}.gpg`);
  const run = restore(root, ['--storage-only', sealed, '--yes'], { VOLUME_INSPECT_EXIT: '1' });
  assert.equal(run.status, 1, show(run));
  assert.ok(
    run.calls.some((call) => call.startsWith('gpg --decrypt --output')),
    show(run),
  );
  assert.deepEqual(
    readdirSync(join(root, 'backups', 'uploads', NIGHT)).filter((name) => name.endsWith('.tmp')),
    [],
  );
  assert.match(run.calls.at(-1) ?? '', / up -d --no-deps supabase-storage$/u, show(run));
});

for (const [name, args] of [
  [
    'a --storage-file that is not there',
    (root) => [put(root, DB), '--yes', '--storage-file', STORAGE],
  ],
  ['a --storage-only file that is not there', () => ['--storage-only', STORAGE, '--yes']],
  [
    '--storage-only with a database file',
    (root) => [put(root, DB), '--storage-only', put(root, STORAGE), '--yes'],
  ],
  [
    '--storage-only with --db-only',
    (root) => ['--storage-only', put(root, STORAGE), '--db-only', '--yes'],
  ],
  [
    '--storage-only with --from-s3',
    (root) => ['--storage-only', put(root, STORAGE), '--from-s3', NIGHT, '--yes'],
  ],
  [
    '--storage-only with --storage-file',
    (root) => ['--storage-only', put(root, STORAGE), '--storage-file', put(root, STORAGE), '--yes'],
  ],
  [
    '--storage-file with --db-only',
    (root) => [put(root, DB), '--storage-file', put(root, STORAGE), '--db-only', '--yes'],
  ],
  ['a flag with no value', (root) => [put(root, DB), '--yes', '--storage-file']],
  ['two database files', (root) => [put(root, DB), put(root, DB), '--yes']],
  ['a database file with --from-s3', (root) => [put(root, DB), '--from-s3', NIGHT, '--yes']],
  [
    '--storage-file with --from-s3',
    (root) => ['--from-s3', NIGHT, '--storage-file', put(root, STORAGE), '--yes'],
  ],
  ['an option it does not know', (root) => [put(root, DB), '--yes', '--everything']],
  ['nothing to restore', () => ['--yes']],
]) {
  test(`refused before anything stops: ${name}`, { skip }, () => {
    const root = sandbox();
    // With a bucket configured, so a refusal is the flags' and never a missing bucket's.
    const run = restore(root, args(root), BUCKET);
    assert.equal(run.status, 1, show(run));
    assert.match(run.output, /✗/u, show(run));
    assert.deepEqual(run.calls, [], show(run));
  });
}

// The ops runner's cloud restore: `--from-s3 <ts> --yes`, unchanged by the new flags.
test('--from-s3 pulls the night from the bucket and restores both', { skip }, () => {
  const run = restore(sandbox(), ['--from-s3', NIGHT, '--yes'], BUCKET);
  assert.equal(run.status, 0, show(run));
  assert.ok(
    run.calls.some((call) =>
      call.startsWith(`aws s3 cp s3://bucket/myclash/db-${NIGHT}.sql.gz ${NIGHTLY_DB}`),
    ),
    show(run),
  );
  assert.ok(
    run.calls.some((call) => call.includes('DROP DATABASE')),
    show(run),
  );
  assert.ok(run.calls.includes(`gunzip -c ${NIGHTLY_STORAGE}`), show(run));
  assert.match(run.calls.at(-1) ?? '', / up -d$/u, show(run));
});
