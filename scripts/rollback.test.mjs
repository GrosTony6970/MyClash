import assert from 'node:assert/strict';
import test from 'node:test';
import * as rollbackModule from './rollback.ts';

/**
 * `infra/scripts/rollback.sh` restores Postgres from a backup and runs
 * `git reset --hard`. It asks before doing either, and that prompt only works
 * over an SSH session with a TTY.
 *
 * Without one the prompt reads EOF, and the failure mode is not "it stops" —
 * it is "an unattended process decides for you, during an incident". So the
 * wrapper refuses up front, and this pins that refusal.
 *
 * Importing this module at all is only safe because rollback.ts guards its
 * `main()` call on being invoked directly.
 */

// The repo has no `"type": "module"`, so tsx transpiles .ts to CJS and named
// exports arrive under `default`. Same shape-tolerant read as deploy.test.mjs.
const { requireTty } = rollbackModule.default ?? rollbackModule;

/** Runs `fn` with stdin/stdout TTY flags forced, capturing any process.exit. */
function withTty({ stdin, stdout }, fn) {
  const origExit = process.exit;
  const origIn = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const origOut = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  const origErr = console.error;

  let exitCode = null;
  process.exit = (code) => {
    exitCode = code;
    throw new Error('__exit__');
  };
  Object.defineProperty(process.stdin, 'isTTY', { value: stdin, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: stdout, configurable: true });
  console.error = () => {};

  try {
    fn();
  } catch (e) {
    if (e.message !== '__exit__') throw e;
  } finally {
    process.exit = origExit;
    console.error = origErr;
    if (origIn) Object.defineProperty(process.stdin, 'isTTY', origIn);
    else delete process.stdin.isTTY;
    if (origOut) Object.defineProperty(process.stdout, 'isTTY', origOut);
    else delete process.stdout.isTTY;
  }
  return exitCode;
}

test('rollback refuses to run without an interactive terminal', () => {
  assert.equal(withTty({ stdin: false, stdout: false }, requireTty), 1);
  assert.equal(withTty({ stdin: true, stdout: false }, requireTty), 1);
  assert.equal(withTty({ stdin: false, stdout: true }, requireTty), 1);
});

test('rollback proceeds when both streams are a TTY', () => {
  assert.equal(withTty({ stdin: true, stdout: true }, requireTty), null);
});
