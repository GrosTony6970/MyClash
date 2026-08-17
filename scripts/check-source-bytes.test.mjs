import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  BINARY_SUFFIXES,
  SOURCE_SUFFIXES,
  findControlBytes,
  isControlByte,
  scanSources,
} from './check-source-bytes.mjs';
import { REPO_IGNORED_DIRS } from './lib/repo-scan.mjs';

// Fixtures are built from byte arrays on purpose. Typing a raw control byte
// into this file would make the gate red on its own test — which is the whole
// defect, arrived at from the inside.
const bytes = (...values) => Buffer.from(values);
const text = (string) => Buffer.from(string, 'utf8');

// ── The predicate ────────────────────────────────────────────────────────────

test('flags every C0 control byte and DEL', () => {
  for (const byte of [0x00, 0x01, 0x03, 0x04, 0x0b, 0x0c, 0x1b, 0x1f, 0x7f]) {
    assert.equal(isControlByte(byte), true, `0x${byte.toString(16)}`);
  }
});

test('permits tab, line feed and carriage return', () => {
  // CR matters: .gitattributes gives *.ps1 / *.bat / *.cmd eol=crlf, so a CRLF
  // working tree is legitimate and must not fail this gate on Windows.
  for (const byte of [0x09, 0x0a, 0x0d]) {
    assert.equal(isControlByte(byte), false, `0x${byte.toString(16)}`);
  }
});

test('permits ordinary printable and multi-byte text', () => {
  for (const byte of [0x20, 0x41, 0x7e, 0xc3, 0xa9]) {
    assert.equal(isControlByte(byte), false, `0x${byte.toString(16)}`);
  }
});

// ── Locating ─────────────────────────────────────────────────────────────────

test('reports the byte with its line and column', () => {
  const buffer = Buffer.concat([text('const a = 1;\nconst key = "x'), bytes(0x00), text('y";\n')]);
  assert.deepEqual(findControlBytes(buffer), [{ byte: 0x00, line: 2, column: 15 }]);
});

test('counts lines from LF only, so a CRLF file still reports the right line', () => {
  const buffer = Buffer.concat([text('a\r\nb\r\nc'), bytes(0x03)]);
  assert.deepEqual(findControlBytes(buffer), [{ byte: 0x03, line: 3, column: 2 }]);
});

test('finds every occurrence, not just the first', () => {
  const buffer = Buffer.concat([text('PK'), bytes(0x03, 0x04)]);
  assert.deepEqual(findControlBytes(buffer), [
    { byte: 0x03, line: 1, column: 3 },
    { byte: 0x04, line: 1, column: 4 },
  ]);
});

test('says nothing about a clean file', () => {
  assert.deepEqual(findControlBytes(text("const k = '\\x00__none__';\n")), []);
});

// ── The rule over paths ──────────────────────────────────────────────────────

test('names the file and quotes the escape to use', () => {
  const files = { 'src/a.ts': Buffer.concat([text('x'), bytes(0x00)]), 'src/b.ts': text('clean') };
  const violations = scanSources(
    Object.keys(files),
    (path) => files[path],
    (path) => path,
  );
  assert.equal(violations.length, 1);
  assert.match(violations[0], /^src\/a\.ts:1:2: 0x00 is written as a raw byte/);
  assert.match(violations[0], /escape sequence \(\\x00\)/);
});

test('returns nothing when every file is clean', () => {
  assert.deepEqual(
    scanSources(
      ['a', 'b'],
      () => text('fine'),
      (p) => p,
    ),
    [],
  );
});

// ── Classification completeness ──────────────────────────────────────────────
// The allowlist's weakness is that a new source type goes unscanned in silence.
// This is what makes that loud. It runs over TRACKED files only, so an
// untracked local artefact can never fail it, and over WALKABLE paths only, so
// it does not promise coverage the gate does not have.

const trackedFiles = () =>
  execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 })
    .split('\0')
    .filter(Boolean);

const isWalkable = (path) => !path.split('/').some((segment) => REPO_IGNORED_DIRS.has(segment));

test('every tracked file the walk reaches is classified as source or as binary', () => {
  const unclassified = new Set();
  for (const path of trackedFiles().filter(isWalkable)) {
    const known =
      SOURCE_SUFFIXES.some((suffix) => path.endsWith(suffix)) ||
      BINARY_SUFFIXES.some((suffix) => path.endsWith(suffix));
    if (!known) unclassified.add(path);
  }
  assert.deepEqual(
    [...unclassified],
    [],
    'classify these in SOURCE_SUFFIXES or BINARY_SUFFIXES in scripts/check-source-bytes.mjs — until one of them names it, this gate does not read the file',
  );
});

test('the two lists do not overlap', () => {
  const overlap = SOURCE_SUFFIXES.filter((suffix) => BINARY_SUFFIXES.includes(suffix));
  assert.deepEqual(overlap, []);
});

// ── Registration ─────────────────────────────────────────────────────────────
// Registration is not execution. check-edge-plugins.mjs is 541 lines with 458
// lines of tests and no workflow invokes it, so its body has never run. This
// gate asserts its own wiring from HERE rather than from its own body: a gate
// that checks whether it is invoked cannot report anything once it is not, and
// pnpm test:scripts runs either way.

test('package.json exposes the gate', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(manifest.scripts?.['quality:source-bytes'], 'node scripts/check-source-bytes.mjs');
});

test('CI runs the gate as its own step', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.ok(
    ci.includes('pnpm quality:source-bytes'),
    'CI lint job must run pnpm quality:source-bytes',
  );
  // Its own verdict, not chained behind another gate's exit code. Eight gates
  // once sat behind a red `&&` chain for about six weeks without running.
  assert.ok(
    !/&&\s*pnpm quality:source-bytes/.test(ci),
    'quality:source-bytes must be its own step, never &&-chained behind another gate',
  );
});
