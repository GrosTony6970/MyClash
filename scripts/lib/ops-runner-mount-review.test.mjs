import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROOT_DIR_VALUE,
  envExampleRootDirFindings,
  opsRunnerMountFindings,
  restoreRestartFindings,
} from './ops-runner-mount-review.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(join(REPO, file), 'utf8');

/** The ops-runner block of the prod compose file, up to the next service. */
function opsRunnerBlock() {
  const compose = read('infra/docker-compose.prod.yml');
  const start = compose.indexOf('\n  ops-runner:\n');
  assert.notEqual(start, -1, 'no ops-runner service');
  const next = compose.slice(start + 1).search(/\n {2}[a-z][a-z-]*:\n/u);
  return compose.slice(start + 1, next === -1 ? undefined : start + 1 + next);
}

test('the prod ops runner mounts and works at MYCLASH_ROOT_DIR', () => {
  assert.deepEqual(opsRunnerMountFindings(opsRunnerBlock()), []);
});

test('restore.sh restarts with up -d --no-recreate', () => {
  assert.deepEqual(restoreRestartFindings(read('infra/scripts/restore.sh')), []);
});

test('.env.example holds no MYCLASH_ROOT_DIR line', () => {
  assert.deepEqual(envExampleRootDirFindings(read('.env.example')), []);
});

test('each rule fires on the shape it forbids', () => {
  const good = [
    `    working_dir: ${ROOT_DIR_VALUE}`,
    `      MYCLASH_ROOT_DIR: ${ROOT_DIR_VALUE}`,
    `      - ../:${ROOT_DIR_VALUE}`,
  ].join('\n');
  assert.deepEqual(opsRunnerMountFindings(good), []);
  assert.equal(opsRunnerMountFindings(good.replace('../:', '../:/srv/myclash #')).length, 2);
  assert.equal(opsRunnerMountFindings(`${good}\n    working_dir: ${ROOT_DIR_VALUE}`).length, 1);

  assert.equal(restoreRestartFindings('  RESTART=("${COMPOSE[@]}" up -d)\n').length, 1);
  assert.equal(
    restoreRestartFindings('RESTART=("${COMPOSE[@]}" up -d --no-recreate --no-deps x)\n').length,
    0,
  );
  assert.equal(restoreRestartFindings('echo nothing\n').length, 1);

  assert.equal(envExampleRootDirFindings('MYCLASH_ROOT_DIR=\n').length, 1);
  assert.equal(envExampleRootDirFindings('# MYCLASH_ROOT_DIR= is set by the scripts\n').length, 0);
});
