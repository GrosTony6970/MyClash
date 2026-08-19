import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { defineGate, nothingToCount } from './gate.mjs';

const gateModule = JSON.stringify(pathToFileURL(join(import.meta.dirname, 'gate.mjs')).href);
const realOtherModule = pathToFileURL(join(import.meta.dirname, 'repo-scan.mjs')).href;

/**
 * Run a gate body as its own process, the way CI runs one.
 *
 * ── Why a fixture and not a real gate ───────────────────────────────────────
 * The one thing that cannot be checked by importing this module is whether the
 * invocation guard fires at all — a guard that is wrong in the false direction
 * turns every gate in the fleet into a silent no-op that passes. Proving it
 * needs a real spawned process.
 *
 * It must not be a real gate. Spawning scripts/check-todos.mjs would tie this
 * file to whether the repo happens to carry a debt marker today, so it would go
 * red for reasons that have nothing to do with the harness. Same reasoning as
 * the injected reader in check-source-bytes.mjs: give the test its own input.
 */
function spawnGate(body, argv = []) {
  const dir = mkdtempSync(join(tmpdir(), 'gate-harness-'));
  try {
    const file = join(dir, 'check-fixture.mjs');
    writeFileSync(file, `import { defineGate } from ${gateModule};\n\n${body}\n`);
    const result = spawnSync(process.execPath, [file, ...argv], {
      encoding: 'utf8',
      timeout: 20_000,
    });
    assert.equal(result.signal, null, `fixture did not terminate on its own: ${result.stderr}`);
    return result;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const returning = (result) => `
defineGate({
  name: 'Fixture gate',
  entry: import.meta.url,
  run: () => (${result}),
});`;

// ── The gate is a value, and defining one has no effect ──────────────────────

test('defineGate returns the gate so a test can run it with no process involved', async () => {
  const gate = defineGate({
    name: 'Fixture gate',
    entry: realOtherModule,
    run: ({ argv }) => ({ findings: [], summary: `saw ${argv.join()}`, scanned: 1 }),
  });

  assert.equal(gate.name, 'Fixture gate');
  assert.deepEqual(await gate.run({ argv: ['--flag'] }), {
    findings: [],
    summary: 'saw --flag',
    scanned: 1,
  });
});

/**
 * Define a gate against a clean exit code and hand back what it became.
 *
 * The zeroing is the point. Reading `process.exitCode` before and comparing
 * after looks equivalent and is not: an earlier call in this same file may have
 * already pushed it to 1, and the assertion then compares 1 against 1 and
 * passes. A mutation that sets the fail-safe at module scope — the one that
 * would fail `pnpm perf:bundle:build` the moment build-app-bundles.mjs imports
 * a gate — survived exactly that hole before this helper existed.
 */
function exitCodeAfterDefining(entry) {
  const before = process.exitCode;
  process.exitCode = 0;
  try {
    defineGate({
      name: 'Fixture gate',
      entry,
      run: () => assert.fail('run() must not fire unless the gate is the entry point'),
    });
    return process.exitCode;
  } finally {
    process.exitCode = before;
  }
}

test('defining a gate that is not the entry point does not run it', () => {
  assert.equal(exitCodeAfterDefining(realOtherModule), 0);
});

test('an entry that no longer resolves is not this module either', () => {
  // The guard has to answer false rather than throw: a gate whose path is gone
  // is not the program node was asked to run, and an exception here would break
  // every importer of every gate.
  const missing = pathToFileURL(join(import.meta.dirname, 'no-such-gate.mjs')).href;

  assert.equal(exitCodeAfterDefining(missing), 0);
});

test('defineGate rejects a declaration it cannot honour', () => {
  const run = () => ({ findings: [], summary: 'ok', scanned: 1 });

  assert.throws(() => defineGate({ entry: realOtherModule, run }), /name is required/);
  assert.throws(() => defineGate({ name: 'x', entry: '../gate.mjs', run }), /import\.meta\.url/);
  assert.throws(() => defineGate({ name: 'x', entry: realOtherModule }), /run must be a function/);
});

// ── Spawned: the guard fires, and the exit code means what it says ───────────

test('a gate spawned as a CLI actually runs, and a clean one exits 0', () => {
  const { status, stdout } = spawnGate(
    returning(`{ findings: [], summary: 'all clear', scanned: 7 }`),
  );

  assert.equal(status, 0);
  assert.match(stdout, /all clear/);
});

test('argv reaches run without the gate touching process.argv', () => {
  const { status, stdout } = spawnGate(
    returning(`{ findings: [], summary: 'argv=' + argv.join(','), scanned: 1 }`).replace(
      'run: () =>',
      'run: ({ argv }) =>',
    ),
    ['--write', '--deep'],
  );

  assert.equal(status, 0);
  assert.match(stdout, /argv=--write,--deep/);
});

test('error findings fail the build and print under one header', () => {
  const { status, stderr } = spawnGate(
    returning(
      `{ findings: [{ level: 'error', message: 'a.ts:1: bad' }], summary: 'unused', scanned: 2 }`,
    ),
  );

  assert.equal(status, 1);
  assert.match(stderr, /Fixture gate failed:/);
  assert.match(stderr, /- a\.ts:1: bad/);
});

test('warnings alone are reported and still pass', () => {
  const { status, stdout, stderr } = spawnGate(
    returning(
      `{ findings: [{ level: 'warn', message: 'worth a look' }], summary: 'ok', scanned: 2 }`,
    ),
  );

  assert.equal(status, 0);
  assert.match(stderr, /! worth a look/);
  assert.match(stdout, /ok/);
});

test('a finding with no level is an error, not a warning', () => {
  // Six gates pushed bare strings before this harness existed. A half-finished
  // migration hands us one, and the safe reading is "blocker", not "noise".
  const { status, stderr } = spawnGate(
    returning(`{ findings: ['a bare string'], summary: 'unused', scanned: 2 }`),
  );

  assert.equal(status, 1);
  assert.match(stderr, /- a bare string/);
});

// ── Anti-vacuity and the broken-gate report ─────────────────────────────────

test('a scan that examined nothing is a broken gate, not a clean repo', () => {
  const { status, stdout, stderr } = spawnGate(
    returning(`{ findings: [], summary: 'looked at everything', scanned: 0 }`),
  );

  assert.equal(status, 1);
  assert.match(stderr, /scanned nothing/);
  assert.doesNotMatch(stdout, /looked at everything/);
});

test('a zero count does not swallow findings the gate did report', () => {
  // Validation runs before reporting, so an unconditional throw here would
  // replace real output with "scanned nothing". check-edge-plugins rejects an
  // unknown --mode before probing anything, and that message is the useful part.
  const { status, stderr } = spawnGate(
    returning(`{ findings: ['Unknown --mode value "staging"'], summary: 'unused', scanned: 0 }`),
  );

  assert.equal(status, 1);
  assert.match(stderr, /- Unknown --mode value "staging"/);
  assert.doesNotMatch(stderr, /scanned nothing/);
});

test('warnings alone do not excuse an empty scan', () => {
  // A warning-only run still exits 0, which is exactly the silent pass the
  // count exists to catch.
  const { status, stderr } = spawnGate(
    returning(
      `{ findings: [{ level: 'warn', message: 'heads up' }], summary: 'unused', scanned: 0 }`,
    ),
  );

  assert.equal(status, 1);
  assert.match(stderr, /scanned nothing/);
});

test('a gate may say it had nothing to count, but only by name and with a reason', () => {
  // The opt-out exists because check-edge-plugins genuinely examines nothing
  // when the kill-switch has detached the middlewares. It must stay deliberate:
  // `scanned: 0` is the signature of broken discovery and can never mean this.
  const opted = spawnGate(`
import { nothingToCount } from ${gateModule};
defineGate({
  name: 'Fixture gate',
  entry: import.meta.url,
  run: () => ({
    findings: [],
    summary: 'nothing to do',
    scanned: nothingToCount('the kill-switch returns before any probe runs'),
  }),
});`);

  assert.equal(opted.status, 0);
  assert.match(opted.stderr, /~ nothing to count: the kill-switch returns before any probe runs/);
  assert.match(opted.stdout, /nothing to do/);
});

test('the opt-out refuses to be anonymous', () => {
  assert.throws(() => nothingToCount(), /a reason is required/);
  assert.throws(() => nothingToCount(''), /a reason is required/);
});

test('an object that is not the opt-out is still a missing count', () => {
  // Otherwise any stray object would slip past the check the count exists for.
  const { status, stderr } = spawnGate(
    returning(`{ findings: [], summary: 'ok', scanned: { pretending: true } }`),
  );

  assert.equal(status, 1);
  assert.match(stderr, /no scanned count/);
});

test('a result missing its summary or its count is a broken gate', () => {
  const noSummary = spawnGate(returning(`{ findings: [], scanned: 3 }`));
  const noCount = spawnGate(returning(`{ findings: [], summary: 'ok' }`));

  assert.equal(noSummary.status, 1);
  assert.match(noSummary.stderr, /no summary/);
  assert.equal(noCount.status, 1);
  assert.match(noCount.stderr, /no scanned count/);
});

test('the remedy prints after the findings, and only when the gate failed', () => {
  // The paragraph saying what to DO is the difference between a list of paths
  // and a fix — check-openapi-drift names the regenerate command there. Printing
  // it on a pass would be noise on every green run.
  const failed = spawnGate(
    returning(
      `{ findings: ['a.ts:1: bad'], summary: 'unused', scanned: 2, remedy: 'Regenerate with: pnpm openapi:client' }`,
    ),
  );
  const passed = spawnGate(
    returning(`{ findings: [], summary: 'ok', scanned: 2, remedy: 'Regenerate with: pnpm x' }`),
  );

  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /- a\.ts:1: bad[\s\S]*Regenerate with: pnpm openapi:client/);
  assert.equal(passed.status, 0);
  assert.doesNotMatch(passed.stderr, /Regenerate/);
});

test('a remedy that is not text is a broken gate', () => {
  const { status, stderr } = spawnGate(
    returning(`{ findings: [], summary: 'ok', scanned: 2, remedy: ['do', 'this'] }`),
  );

  assert.equal(status, 1);
  assert.match(stderr, /remedy must be a non-empty string/);
});

test('a throw out of run is reported as a broken gate, with its stack', () => {
  const { status, stderr } = spawnGate(`
defineGate({
  name: 'Fixture gate',
  entry: import.meta.url,
  run: () => { throw new Error('the rule blew up'); },
});`);

  assert.equal(status, 1);
  assert.match(stderr, /the gate is broken, not the repo/);
  assert.match(stderr, /the rule blew up/);
});

// ── The two failure modes that look like success ────────────────────────────

test('a run that never settles exits 1 rather than draining to a clean 0', () => {
  // Without the fail-safe this is the worst outcome the harness can produce: a
  // pending promise keeps nothing alive, so node drains the loop and exits 0 —
  // a gate that never looked at anything reporting a clean repo.
  const { status, stdout } = spawnGate(`
defineGate({
  name: 'Fixture gate',
  entry: import.meta.url,
  run: () => new Promise(() => {}),
});`);

  assert.equal(status, 1);
  assert.equal(stdout, '');
});

test('the harness sets an exit code rather than calling process.exit', () => {
  // process.exit would terminate without unwinding, so a gate's own cleanup
  // would silently never run — the defect that leaked 344 temp directories out
  // of check-openapi-drift.mjs. A timer queued behind the report only fires if
  // the process was allowed to drain.
  const { status, stdout } = spawnGate(`
defineGate({
  name: 'Fixture gate',
  entry: import.meta.url,
  run: () => ({ findings: [{ message: 'fails the build' }], summary: 'unused', scanned: 1 }),
});
setTimeout(() => console.log('the process drained'), 0);`);

  assert.equal(status, 1);
  assert.match(stdout, /the process drained/);
});
