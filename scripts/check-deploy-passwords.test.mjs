import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  checkDeployPasswords,
  passwordProblems,
  readGoTruePolicy,
} from './check-deploy-passwords.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const composePath = path.join(root, 'infra', 'docker-compose.prod.yml');
const policy = readGoTruePolicy(readFileSync(composePath, 'utf8'));
const script = path.join(root, 'scripts', 'check-deploy-passwords.mjs');

// The demo owner's password that GoTrue 2.198 refused: long, lower + upper + digits, no symbol.
const NO_SYMBOL = 'abcdefghijKLMNOPQR123456';
const GOOD = 'abcdefghijKLMNOPQR12345!';

test("reads GoTrue's rule from the production compose file", () => {
  assert.equal(policy.minLength, 12);
  assert.equal(policy.groups.length, 4);
  assert.ok(policy.groups[3].includes('$'), 'compose `$$` reads as one `$`');
  assert.ok(policy.groups[3].includes("'"), "a doubled `''` reads as one `'`");
});

test('names the missing symbol of a long password, as GoTrue refused it', () => {
  assert.deepEqual(passwordProblems(NO_SYMBOL, policy), [
    `missing a symbol, one of ${policy.groups[3]}`,
  ]);
  assert.deepEqual(passwordProblems(GOOD, policy), []);
});

test('counts the length in characters, not bytes, as GoTrue 2.198 does', () => {
  assert.deepEqual(passwordProblems('aA1!é', policy), ['5 characters, at least 12 needed']);
  assert.deepEqual(passwordProblems('aA1!🙂🙂🙂🙂🙂🙂🙂🙂', policy), []);
});

test('reports each refused variable by name, and skips one that is not set', () => {
  const env = {
    E2E_ADMIN_PASSWORD: NO_SYMBOL,
    SEED_ADMIN_PASSWORD: GOOD,
    E2E_SUPERADMIN_PASSWORD: '',
  };
  assert.deepEqual(
    checkDeployPasswords(
      ['SEED_ADMIN_PASSWORD', 'E2E_ADMIN_PASSWORD', 'E2E_SUPERADMIN_PASSWORD'],
      env,
      policy,
    ),
    [`E2E_ADMIN_PASSWORD: missing a symbol, one of ${policy.groups[3]}`],
  );
});

test('the command exits 1, names the variable and never prints the password', () => {
  const run = spawnSync(process.execPath, [script, composePath, 'E2E_ADMIN_PASSWORD'], {
    env: { ...process.env, E2E_ADMIN_PASSWORD: NO_SYMBOL },
    encoding: 'utf8',
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /^E2E_ADMIN_PASSWORD: missing a symbol/u);
  assert.ok(!run.stderr.includes(NO_SYMBOL) && !run.stdout.includes(NO_SYMBOL));

  const ok = spawnSync(process.execPath, [script, composePath, 'E2E_ADMIN_PASSWORD'], {
    env: { ...process.env, E2E_ADMIN_PASSWORD: GOOD },
    encoding: 'utf8',
  });
  assert.equal(ok.status, 0);
});
