/**
 * infra/scripts/backup.sh's pruning of the copies deploy.sh takes before each update
 * (backups/pre-deploy/). deploy.sh prunes them only when a deploy runs; the privacy policy (§6.1,
 * ruling 499) says they last about 30 days, so the nightly backup prunes them too.
 *
 * The script and its libs run in a temporary root (it `cd`s two levels above itself) with a
 * `docker` stub that fails: the dump and the archive are skipped, the pruning still runs.
 *
 * Also how it reads `docker compose ps`: a failing `ps` (the daemon unreachable) is reported as
 * that failure, never as a stopped database.
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
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Git Bash on Windows: System32's bash.exe is WSL, which cannot read a Windows PATH.
const BASH = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const skip = process.platform === 'win32' && !existsSync(BASH) ? 'needs Git Bash' : false;

const roots = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

const FAILING_DOCKER = ['#!/usr/bin/env bash', 'exit 1', ''].join('\n');

/** compose is installed; `ps` answers as `PS_ANSWER` says; anything else (exec, volume) fails.
 *  Its warning names a db container, as compose's own orphan warning can: a stopped database
 *  must not read as running because a warning line contains "db". */
const ORPHAN_WARNING =
  'level=warning msg=Found orphan containers ([myclash-db-1]) for this project';
const COMPOSE_DOCKER = [
  '#!/usr/bin/env bash',
  'case " $* " in',
  '  *" version "*) exit 0 ;;',
  // Only the call backup.sh means to make: without these flags the answer would differ.
  '  *" ps --status running --services ")',
  '    case "$PS_ANSWER" in',
  '      unreachable) echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock" >&2; exit 1 ;;',
  `      stopped) echo "${ORPHAN_WARNING}" >&2; exit 0 ;;`,
  `      running) echo "${ORPHAN_WARNING}" >&2; echo db; exit 0 ;;`,
  '    esac ;;',
  'esac',
  'exit 1',
  '',
].join('\n');

function sandbox(docker = FAILING_DOCKER) {
  const root = mkdtempSync(join(tmpdir(), 'backup-sh-'));
  roots.push(root);
  const scripts = join(root, 'infra', 'scripts');
  mkdirSync(join(scripts, 'lib'), { recursive: true });
  copyFileSync(join(REPO, 'infra/scripts/backup.sh'), join(scripts, 'backup.sh'));
  for (const lib of readdirSync(join(REPO, 'infra/scripts/lib'))) {
    copyFileSync(join(REPO, 'infra/scripts/lib', lib), join(scripts, 'lib', lib));
  }
  writeFileSync(join(root, '.env'), 'POSTGRES_USER=postgres\nPOSTGRES_DB=myclash\n');
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'bin', 'docker'), docker, { mode: 0o755 });
  return root;
}

/** A pre-deploy copy last written `days` ago. */
function copyAged(root, name, days) {
  const dir = join(root, 'backups', 'pre-deploy');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, 'dump');
  const when = new Date(Date.now() - days * 24 * 3600 * 1000);
  utimesSync(file, when, when);
  return file;
}

function backup(root, psAnswer = '') {
  const result = spawnSync(
    BASH,
    [
      '-c',
      'PATH="$(cd "$STUB_BIN" && pwd):$PATH" exec bash "$0"',
      join(root, 'infra/scripts/backup.sh').replaceAll('\\', '/'),
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        STUB_BIN: join(root, 'bin').replaceAll('\\', '/'),
        PS_ANSWER: psAnswer,
      },
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
  return `${result.stdout}${result.stderr}`;
}

test(
  'the nightly backup deletes the pre-deploy copies past 30 days, and keeps the rest',
  { skip },
  () => {
    const root = sandbox();
    const old = copyAged(root, '20260901T100000Z.sql.gz', 40);
    const recent = copyAged(root, '20261101T100000Z.sql.gz', 5);
    const output = backup(root);
    assert.equal(existsSync(old), false, output);
    assert.equal(existsSync(recent), true, output);
    assert.doesNotMatch(output, /pre-deploy copies/u, output);
  },
);

test('a server with no pre-deploy folder yet backs up without a word about it', { skip }, () => {
  const root = sandbox();
  const output = backup(root);
  assert.equal(existsSync(join(root, 'backups', 'pre-deploy')), false, output);
  assert.doesNotMatch(output, /pre-deploy/u, output);
});

test(
  'a compose ps that fails is reported with its reason, not as a stopped database',
  { skip },
  () => {
    const output = backup(sandbox(COMPOSE_DOCKER), 'unreachable');
    assert.match(
      output,
      /docker compose ps failed — cannot dump Postgres: Cannot connect to the Docker daemon/u,
      output,
    );
    assert.doesNotMatch(output, /not running/u, output);
    // The run goes on to the storage archive, and its result is a failure.
    assert.match(output, /Storage volume archive/u, output);
    assert.match(output, /Backup completed with errors/u, output);
  },
);

test('a database that is not running is still reported as not running', { skip }, () => {
  const output = backup(sandbox(COMPOSE_DOCKER), 'stopped');
  assert.match(output, /DB container not running — skipping Postgres dump/u, output);
  assert.doesNotMatch(output, /docker compose ps failed/u, output);
});

test('a running database is dumped, whatever compose warns about', { skip }, () => {
  const output = backup(sandbox(COMPOSE_DOCKER), 'running');
  // The stub's `exec` fails, so reaching pg_dump shows as its failure.
  assert.match(output, /pg_dump failed/u, output);
  assert.doesNotMatch(output, /not running|docker compose ps failed/u, output);
});
