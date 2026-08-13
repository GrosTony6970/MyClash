import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import test from 'node:test';

import { REPO_IGNORED_DIRS, walkAllFiles, walkRepoFiles } from './repo-scan.mjs';

const root = process.cwd();

/**
 * A tree holding one file in each shape the eight extracted walks disagreed
 * about: plain source, a nested subtree, and three directories that only some
 * of the copies skipped.
 */
function fixtureTree() {
  const dir = mkdtempSync(join(tmpdir(), 'myclash-repo-scan-'));
  for (const [path, body] of [
    ['a.ts', 'a'],
    ['b.js', 'b'],
    ['nested/c.ts', 'c'],
    ['nested/deeper/d.tsx', 'd'],
    ['node_modules/junk.ts', 'junk'],
    ['dist/out.js', 'out'],
    ['.turbo/turbo-build.log', 'log'],
  ]) {
    const absolute = join(dir, ...path.split('/'));
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, body);
  }
  return dir;
}

const relativeTo = (dir) => (path) => relative(dir, path).split(sep).join('/');

test('carries the entries the two hand-maintained copies had each lost', () => {
  // The drift this module exists to end: `_bmad` was excluded by
  // check-complexity.mjs only, `.remember` by check-todos.mjs only.
  assert.ok(REPO_IGNORED_DIRS.has('_bmad'));
  assert.ok(REPO_IGNORED_DIRS.has('.remember'));
});

test('excludes build output, tool caches and test artefacts', () => {
  for (const name of [
    '.agents',
    '.claude',
    '.codex',
    '.git',
    '.kiro',
    '.next',
    '.pnpm-store',
    '.turbo',
    '.understand-anything',
    // Promoted out of check-test-code-leak.mjs's private list, which was the
    // only copy carrying it. eslint.config.mjs already ignores `**/build/**`.
    'build',
    'coverage',
    'dist',
    'node_modules',
    'playwright-report',
    'test-results',
  ]) {
    assert.ok(REPO_IGNORED_DIRS.has(name), `${name} must be ignored`);
  }
});

test('does not exclude a directory holding product source', () => {
  // A blanket entry like `src` or `apps` here would silently empty every scan
  // that uses it, and every gate would go green for the wrong reason.
  for (const name of ['apps', 'packages', 'scripts', 'src', 'infra']) {
    assert.equal(REPO_IGNORED_DIRS.has(name), false, `${name} must be scanned`);
  }
});

/** Every gate that scans a directory tree. */
const WALKING_GATES = [
  'check-api-docs.mjs',
  'check-bundle-budgets.mjs',
  'check-client-secret-boundaries.mjs',
  'check-complexity.mjs',
  'check-realtime-bindings.mjs',
  'check-shared-type-leaks.mjs',
  'check-test-code-leak.mjs',
  'check-todos.mjs',
];

const gateSource = (gate) => readFileSync(join(root, 'scripts', gate), 'utf8');

test('no gate holds a private walk', () => {
  // Falsifies the extraction itself. If a copy is ever reintroduced alongside
  // the import, the two drift again and this module stops being the one place
  // a scanning decision has to be made. The eight copies this replaced used
  // three different names, so match the shape rather than any one of them.
  for (const gate of WALKING_GATES) {
    const source = gateSource(gate);
    assert.match(source, /walkRepoFiles|walkAllFiles/, `${gate} must use the shared walk`);
    assert.doesNotMatch(
      source,
      /function\s+walk\w*\s*\(/,
      `${gate} must not declare its own directory walk`,
    );
  }
});

test('no gate holds a private ignore list', () => {
  // Name-independent: the copies spelled it `ignoredDirs`, `IGNORED_DIRS`, and
  // as a bare chain of `entry === 'node_modules' || …`. What they all had to
  // name is the directory itself, so that is what this forbids.
  for (const gate of WALKING_GATES) {
    assert.doesNotMatch(
      gateSource(gate),
      /node_modules/,
      `${gate} must not name an excluded directory — REPO_IGNORED_DIRS owns that list`,
    );
  }
});

test('the bundle budget cannot inherit the source exclusions', () => {
  // The one gate whose scan targets are dist/ and .next/, which REPO_IGNORED_DIRS
  // excludes. Importing walkRepoFiles here would silently shrink every budget
  // and every one of them would still pass — the failure that file already has
  // a docstring about. A one-word tidy-up must turn this red.
  //
  // Matches the IMPORT and the CALL, not the name. The first version of this
  // test matched the bare word and went red on the docstring explaining why the
  // rule exists — a gate reading prose as code, which is the same defect
  // check-db-review.mjs was hardened against.
  const source = gateSource('check-bundle-budgets.mjs');
  assert.match(source, /walkAllFiles\s*\(/);
  assert.doesNotMatch(
    source,
    /import\s*\{[^}]*\bwalkRepoFiles\b[^}]*\}/,
    'check-bundle-budgets.mjs weighs build output and must never import the source walk',
  );
  assert.doesNotMatch(
    source,
    /walkRepoFiles\s*\(/,
    'check-bundle-budgets.mjs weighs build output and must never call the source walk',
  );
});

// ── walkRepoFiles / walkAllFiles ─────────────────────────────────────────────

test('descends recursively and skips the ignored directories at any depth', () => {
  const dir = fixtureTree();
  assert.deepEqual(walkRepoFiles(dir).map(relativeTo(dir)).sort(), [
    'a.ts',
    'b.js',
    'nested/c.ts',
    'nested/deeper/d.tsx',
  ]);
});

test('walks depth-first, so a subtree lands contiguously', () => {
  // The eight copies all recursed inline through flatMap, so a directory's own
  // files arrive together and before the next sibling. Gates print violations
  // in walk order; asserting the property rather than a literal list keeps this
  // honest on filesystems that do not hand back readdir entries alphabetically.
  const dir = fixtureTree();
  const files = walkRepoFiles(dir).map(relativeTo(dir));
  const nested = files.reduce((hits, file, index) => {
    return file.startsWith('nested/') ? [...hits, index] : hits;
  }, []);
  assert.equal(nested.length, 2);
  assert.equal(nested[1] - nested[0], 1, `nested/ files are not contiguous: ${files.join(', ')}`);
});

test('walkAllFiles reads the build output walkRepoFiles exists to exclude', () => {
  // check-bundle-budgets.mjs weighs apps/web-marketing/dist and reads chunk
  // manifests out of .next/. A budget that inherited the source exclusions
  // would measure a subset and still pass.
  const dir = fixtureTree();
  assert.deepEqual(walkAllFiles(dir).map(relativeTo(dir)).sort(), [
    '.turbo/turbo-build.log',
    'a.ts',
    'b.js',
    'dist/out.js',
    'nested/c.ts',
    'nested/deeper/d.tsx',
    'node_modules/junk.ts',
  ]);
});

test('filters by extension suffix, and returns everything without one', () => {
  const dir = fixtureTree();
  assert.deepEqual(
    walkRepoFiles(dir, { extensions: ['.ts'] })
      .map(relativeTo(dir))
      .sort(),
    ['a.ts', 'nested/c.ts'],
  );
  assert.equal(walkRepoFiles(dir, { extensions: ['.ts', '.tsx'] }).length, 3);
  assert.equal(walkRepoFiles(dir, { extensions: [] }).length, 0);
});

test('an absent root throws by default and is empty only when asked', () => {
  // A gate whose scan root has moved must be loud. check-bundle-budgets.mjs is
  // the record of what the other answer costs: it pointed at a directory the
  // site had stopped emitting to and reported "0 bytes gzip" as a pass for its
  // entire life.
  const missing = join(fixtureTree(), 'not-here');
  assert.throws(() => walkRepoFiles(missing));
  assert.deepEqual(walkRepoFiles(missing, { missingRoot: 'empty' }), []);
  assert.deepEqual(walkAllFiles(missing, { missingRoot: 'empty' }), []);
});

test('a misspelled missingRoot is refused rather than silently strict', () => {
  assert.throws(() => walkRepoFiles(fixtureTree(), { missingRoot: 'emtpy' }), /missingRoot/u);
});

test(
  'an unreadable subtree throws instead of scanning as empty',
  { skip: process.platform === 'win32' ? 'chmod does not restrict reads on Windows' : false },
  () => {
    // Pins the behaviour check-realtime-bindings.mjs used to have. Its
    // try/catch sat around EVERY level's readdirSync, not just the root, so an
    // unreadable subtree returned [] and the gate passed having scanned less —
    // while its comment claimed to cover only a missing scan root. `absent` and
    // `unreadable` are different answers and only one is safe to read as "no
    // violations here".
    const dir = fixtureTree();
    const sealed = join(dir, 'nested');
    chmodSync(sealed, 0o000);
    try {
      assert.throws(() => walkRepoFiles(dir));
      assert.throws(() => walkRepoFiles(dir, { missingRoot: 'empty' }));
    } finally {
      chmodSync(sealed, 0o755);
    }
  },
);
