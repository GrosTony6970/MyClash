import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnCaptureWithTimeout } from './spawn-capture.mjs';

/** A script that prints 10,000 `x` then `END`, in a file of its own (no `node -e`). */
function printer() {
  const dir = mkdtempSync(path.join(tmpdir(), 'spawn-capture-'));
  const file = path.join(dir, 'print.mjs');
  writeFileSync(file, "process.stdout.write('x'.repeat(10_000) + 'END');\n");
  return { file, dir };
}

/** The test's own timer: a cap that broke the capture must fail, not hang the run. */
function within(ms, promise) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

test('with maxChars, the capture keeps its last characters only', async () => {
  const { file, dir } = printer();
  try {
    const result = await within(
      15_000,
      spawnCaptureWithTimeout(process.execPath, [file], 10_000, { maxChars: 100 }),
    );
    assert.equal(result.code, 0);
    assert.ok(result.stdout.length <= 100, `kept ${result.stdout.length}`);
    assert.ok(result.stdout.endsWith('END'));
    assert.equal(result.capped, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('without maxChars, the capture is whole', async () => {
  const { file, dir } = printer();
  try {
    const result = await within(15_000, spawnCaptureWithTimeout(process.execPath, [file], 10_000));
    assert.equal(result.stdout.length, 10_003);
    assert.equal(result.capped, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
