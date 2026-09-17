/**
 * infra/scripts/destroy.sh run against a fake `docker` that only records its arguments.
 *
 * The script and the libs it sources are copied into a temporary root, because it `cd`s two
 * levels above itself and `--full` deletes data/ and logs/ there: run in place, a test would
 * wipe the repo's own directories.
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
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Git Bash on Windows: System32's bash.exe is WSL, which cannot read a Windows PATH.
const BASH = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const skip = process.platform === 'win32' && !existsSync(BASH) ? 'needs Git Bash' : false;

const roots = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'destroy-sh-'));
  roots.push(root);
  const scripts = join(root, 'infra', 'scripts');
  mkdirSync(join(scripts, 'lib'), { recursive: true });
  copyFileSync(join(REPO, 'infra/scripts/destroy.sh'), join(scripts, 'destroy.sh'));
  for (const lib of readdirSync(join(REPO, 'infra/scripts/lib'))) {
    copyFileSync(join(REPO, 'infra/scripts/lib', lib), join(scripts, 'lib', lib));
  }
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'bin', 'docker'), '#!/usr/bin/env bash\necho "$*" >> "$DOCKER_LOG"\n', {
    mode: 0o755,
  });
  mkdirSync(join(root, 'data', 'postgres'), { recursive: true });
  return root;
}

function destroy(root, ...args) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^path$/iu.test(key)),
  );
  const inheritedPath =
    Object.entries(process.env).find(([key]) => /^path$/iu.test(key))?.[1] ?? '';
  const log = join(root, 'docker.log').replaceAll('\\', '/');
  const result = spawnSync(
    BASH,
    [join(root, 'infra/scripts/destroy.sh').replaceAll('\\', '/'), ...args],
    {
      cwd: root,
      env: { ...env, PATH: `${join(root, 'bin')}${delimiter}${inheritedPath}`, DOCKER_LOG: log },
      input: '',
      encoding: 'utf8',
      // A prompt that stops reading stdin would otherwise hang CI's Lint job silently.
      timeout: 30_000,
    },
  );
  const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  return { status: result.status, output: `${result.stdout}${result.stderr}`, calls };
}

const DOWN = /\bdown --rmi local --remove-orphans\b/u;
const PRUNE = 'builder prune --all --force';

test('without --prune-cache the build cache is kept', { skip }, () => {
  const run = destroy(sandbox(), '--force');
  assert.equal(run.status, 0, run.output);
  assert.ok(
    run.calls.some((call) => DOWN.test(call)),
    `no compose down in: ${run.calls.join(' | ')}`,
  );
  assert.ok(!run.calls.includes(PRUNE), `pruned without being asked: ${run.calls.join(' | ')}`);
});

test('--prune-cache empties the whole build cache once the stack is down', { skip }, () => {
  const run = destroy(sandbox(), '--prune-cache', '--force');
  assert.equal(run.status, 0, run.output);
  const down = run.calls.findIndex((call) => DOWN.test(call));
  const prune = run.calls.indexOf(PRUNE);
  assert.ok(down >= 0, `no compose down in: ${run.calls.join(' | ')}`);
  assert.ok(prune > down, `prune must follow down: ${run.calls.join(' | ')}`);
  assert.match(run.output, /ALL Docker build cache \(the current builder, host-wide\)/u);
});

test('--full --prune-cache wipes data and the build cache together', { skip }, () => {
  const root = sandbox();
  const run = destroy(root, '--full', '--prune-cache', '--force');
  assert.equal(run.status, 0, run.output);
  assert.ok(!existsSync(join(root, 'data', 'postgres')), 'data/postgres survived --full');
  assert.ok(run.calls.includes(PRUNE), `no prune in: ${run.calls.join(' | ')}`);
});

test('the prompt guards the prune: no answer, no docker call', { skip }, () => {
  const run = destroy(sandbox(), '--prune-cache');
  assert.equal(run.status, 0, run.output);
  assert.match(run.output, /Aborted/u);
  assert.deepEqual(run.calls, []);
});

test('service names refuse --prune-cache, which is host-wide', { skip }, () => {
  const run = destroy(sandbox(), 'web-admin', '--prune-cache', '--force');
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /--prune-cache/u);
  assert.deepEqual(run.calls, []);
});
