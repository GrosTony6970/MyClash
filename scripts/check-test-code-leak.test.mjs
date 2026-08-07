import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  buildsWithTsc,
  entryPointSources,
  findLeaks,
  isRelativeSpecifier,
  isTestFile,
  isTestRunnerSpecifier,
  parseWorkspaceGlobs,
  reachesTestRunner,
  resolveRelativeImport,
} from './check-test-code-leak.mjs';

// ── File classification ──────────────────────────────────────────────────────

test('recognises test files by both conventions and both extensions', () => {
  for (const path of ['a.test.ts', 'a.test.tsx', 'a.spec.ts', 'a.spec.tsx', 'x/y/z.test.ts']) {
    assert.equal(isTestFile(path), true, path);
  }
});

test('does not mistake production modules for tests', () => {
  // The five conventions the real test-only helpers actually used. None is a
  // test FILE — rule 3 is what catches these, deliberately not a name match.
  for (const path of [
    'double-elim-test-helpers.ts',
    'common/testing/migration-schema.ts',
    'hema-ratings.fixtures.ts',
    'double-elim-simulation.harness.ts',
    'latest.ts',
    'contest.ts',
  ]) {
    assert.equal(isTestFile(path), false, path);
  }
});

test('recognises test-runner specifiers, not lookalikes', () => {
  for (const s of ['vitest', '@vitest/spy', 'node:test', 'jest', '@jest/globals']) {
    assert.equal(isTestRunnerSpecifier(s), true, s);
  }
  for (const s of ['vitest-fetch-mock', 'my-vitest', '@myclash/types', 'node:fs', 'testing']) {
    assert.equal(isTestRunnerSpecifier(s), false, s);
  }
});

test('separates relative specifiers from package names', () => {
  assert.equal(isRelativeSpecifier('./x'), true);
  assert.equal(isRelativeSpecifier('../x'), true);
  assert.equal(isRelativeSpecifier('@myclash/types'), false);
  assert.equal(isRelativeSpecifier('vitest'), false);
});

// ── Workspace discovery ──────────────────────────────────────────────────────

test('reads the packages globs out of pnpm-workspace.yaml', () => {
  const yaml = [
    'packages:',
    "  - 'apps/*'",
    "  - 'packages/*'",
    '',
    'overrides:',
    '  glob: ^10',
  ].join('\n');
  assert.deepEqual(parseWorkspaceGlobs(yaml), ['apps/*', 'packages/*']);
});

test('throws rather than scanning nothing when the block is missing or empty', () => {
  assert.throws(() => parseWorkspaceGlobs('overrides:\n  glob: ^10\n'), /no top-level/);
  assert.throws(() => parseWorkspaceGlobs('packages:\n\nfoo: 1\n'), /empty/);
});

test('detects tsc-driven builds, including the cleaned and nest forms', () => {
  assert.equal(buildsWithTsc('tsc --project tsconfig.build.json'), true);
  assert.equal(
    buildsWithTsc(`node -e "require('fs').rmSync('dist')" && tsc --project tsconfig.build.json`),
    true,
  );
  assert.equal(buildsWithTsc('nest build'), true);
  assert.equal(buildsWithTsc('next build'), false);
  assert.equal(buildsWithTsc('echo noop'), false);
  assert.equal(buildsWithTsc(undefined), false);
});

// ── Entry points ─────────────────────────────────────────────────────────────

test('maps dist entry points in main/types/exports back to src', () => {
  const sources = entryPointSources({
    main: './dist/index.js',
    types: './dist/index.d.ts',
    exports: {
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
      './scheduling': { default: './dist/scheduling/index.js' },
    },
  });
  assert.equal(sources.has('src/index.ts'), true);
  assert.equal(sources.has('src/scheduling/index.ts'), true);
});

test('treats src/main.ts as an entry even with no manifest fields', () => {
  // Nest apps declare no `main`; the Dockerfile runs `node dist/main.js`.
  assert.equal(entryPointSources({}).has('src/main.ts'), true);
});

// ── Import resolution ────────────────────────────────────────────────────────

// resolveRelativeImport returns platform-native absolute paths (path.resolve
// prepends a drive letter on Windows), so expectations are built the same way
// rather than written as literals.
const abs = (...parts) => resolve('/w/src', ...parts);

test('resolves relative imports through extension and index probing', () => {
  const files = new Set([abs('a.ts'), abs('b.tsx'), abs('dir/index.ts')]);
  const exists = (p) => files.has(p);
  const at = (specifier) => resolveRelativeImport(abs('entry.ts'), specifier, exists);
  assert.equal(at('./a'), abs('a.ts'));
  assert.equal(at('./b'), abs('b.tsx'));
  assert.equal(at('./dir'), abs('dir/index.ts'));
  assert.equal(at('./missing'), null);
});

test('resolves a .js specifier to its .ts source (node16 ESM style)', () => {
  const files = new Set([abs('a.ts')]);
  assert.equal(
    resolveRelativeImport(abs('entry.ts'), './a.js', (p) => files.has(p)),
    abs('a.ts'),
  );
});

// ── Taint propagation ────────────────────────────────────────────────────────

test('taints a module that reaches a test runner through a chain', () => {
  const files = ['a.ts', 'b.ts', 'c.ts', 'clean.ts'];
  const imports = new Map([
    ['a.ts', new Set(['b.ts'])],
    ['b.ts', new Set(['c.ts'])],
    ['c.ts', new Set()],
    ['clean.ts', new Set()],
  ]);
  const bare = new Map([
    ['a.ts', new Set()],
    ['b.ts', new Set()],
    ['c.ts', new Set(['vitest'])],
    ['clean.ts', new Set(['node:fs'])],
  ]);
  const tainted = reachesTestRunner(files, imports, bare);
  // This is the whole point: a.ts names no test runner anywhere in its source,
  // but requiring it in a --prod container still dies two hops down.
  assert.deepEqual([...tainted].sort(), ['a.ts', 'b.ts', 'c.ts']);
});

// ── The rules ────────────────────────────────────────────────────────────────

const noImports = (files) => new Map(files.map((f) => [f, new Set()]));
const noBare = (files) => new Map(files.map((f) => [f, new Set()]));
const identity = (f) => f;

test('rule 1: flags a test file left in the emit surface', () => {
  const files = ['svc.ts', 'svc.test.ts'];
  const found = findLeaks({
    emitFiles: files,
    allFiles: files,
    imports: noImports(files),
    bare: noBare(files),
    label: identity,
  });
  assert.equal(found.length, 1);
  assert.match(found[0], /svc\.test\.ts: test file is in the emit surface/);
});

test('rule 2: flags an emitted module that imports vitest directly', () => {
  const files = ['helper.ts'];
  const found = findLeaks({
    emitFiles: files,
    allFiles: files,
    imports: noImports(files),
    bare: new Map([['helper.ts', new Set(['vitest'])]]),
    label: identity,
  });
  assert.equal(found.length, 1);
  assert.match(found[0], /reaches a test runner/);
});

test('rule 3: flags a module only tests import', () => {
  const files = ['harness.ts', 'a.test.ts'];
  const found = findLeaks({
    emitFiles: ['harness.ts'],
    allFiles: files,
    imports: new Map([
      ['harness.ts', new Set()],
      ['a.test.ts', new Set(['harness.ts'])],
    ]),
    bare: noBare(files),
    label: identity,
  });
  assert.equal(found.length, 1);
  assert.match(found[0], /imported by 1 test file\(s\) and nothing else/);
});

test('rule 3: a module with any production importer is fine', () => {
  const files = ['shared.ts', 'svc.ts', 'a.test.ts'];
  const found = findLeaks({
    emitFiles: ['shared.ts', 'svc.ts'],
    allFiles: files,
    imports: new Map([
      ['shared.ts', new Set()],
      ['svc.ts', new Set(['shared.ts'])],
      ['a.test.ts', new Set(['shared.ts'])],
    ]),
    bare: noBare(files),
    label: identity,
  });
  assert.deepEqual(found, []);
});

test('rule 3: a module with NO importers is fine', () => {
  // Controllers wired by decorators, barrels, entry points — zero relative
  // importers is normal and must not read as a leak.
  const files = ['orphan.ts'];
  assert.deepEqual(
    findLeaks({
      emitFiles: files,
      allFiles: files,
      imports: noImports(files),
      bare: noBare(files),
      label: identity,
    }),
    [],
  );
});

test('rule 3: package entry points are exempt', () => {
  // packages/time/src/index.ts is imported by consumers through the package
  // NAME, which a relative-import graph cannot see. Without the entry-point
  // exemption it looks test-only.
  const files = ['src/index.ts', 'src/index.test.ts'];
  const found = findLeaks({
    emitFiles: ['src/index.ts'],
    allFiles: files,
    imports: new Map([
      ['src/index.ts', new Set()],
      ['src/index.test.ts', new Set(['src/index.ts'])],
    ]),
    bare: noBare(files),
    entries: new Set(['src/index.ts']),
    label: identity,
  });
  assert.deepEqual(found, []);
});

test('rule 3: an allowlisted production module is not flagged', () => {
  const files = ['contract.ts', 'a.test.ts'];
  const args = {
    emitFiles: ['contract.ts'],
    allFiles: files,
    imports: new Map([
      ['contract.ts', new Set()],
      ['a.test.ts', new Set(['contract.ts'])],
    ]),
    bare: noBare(files),
    label: identity,
  };
  assert.equal(findLeaks(args).length, 1);
  assert.deepEqual(findLeaks({ ...args, allowed: { 'contract.ts': 'why' } }), []);
});

test('a clean workspace reports nothing', () => {
  // The realistic shape: a service imported by its Nest module AND its test.
  // A service imported ONLY by its own test is genuinely uncalled, and rule 3
  // is supposed to say so — see the production-importer case above.
  const files = ['svc.ts', 'svc.module.ts', 'svc.test.ts'];
  assert.deepEqual(
    findLeaks({
      emitFiles: ['svc.ts', 'svc.module.ts'],
      allFiles: files,
      imports: new Map([
        ['svc.ts', new Set()],
        ['svc.module.ts', new Set(['svc.ts'])],
        ['svc.test.ts', new Set(['svc.ts'])],
      ]),
      bare: noBare(files),
      label: identity,
    }),
    [],
  );
});
