/**
 * Gate: no test code in the compiled/shipped surface.
 *
 * packages/rulesets shipped `double-elim-test-helpers.ts` — which imports
 * `vitest` — into apps/api's production image, alongside 32 compiled *.test.js
 * in rulesets/dist and 267 more in apps/api/dist. vitest is a devDependency the
 * runner's `--prod` install does not have, so every one of those files was a
 * `require("vitest")` waiting for a caller.
 *
 * 762bbb26 / d0eb3824 split each emitting workspace into a typecheck config
 * (tsconfig.json, tests included) and an emit config (tsconfig.build.json,
 * tests excluded). This gate is what stops that split rotting.
 *
 * It resolves each tsconfig.build.json through the TypeScript API rather than
 * guessing from filenames, because the emit surface is a PROGRAM, not a glob:
 * `exclude` only prunes the ROOT set, so a helper that an included file imports
 * is pulled back in and emitted with the exclusion still sitting there looking
 * correct.
 *
 * Four rules:
 *
 *   1. No *.test.ts / *.spec.ts in the emit program.
 *   2. Nothing in the emit program reaches a test runner, transitively. This is
 *      the crash rule — it is exactly the set of modules that die on `require`
 *      in a --prod container.
 *   3. No module that only tests import. Name-independent, and the reason this
 *      is a program walk and not a glob: the six test-only modules found so far
 *      used FIVE different conventions (*-test-helpers.ts, common/testing/**,
 *      *.fixtures.ts, *.harness.ts), so the next one will invent a sixth.
 *   4. Every workspace that builds with tsc owns a tsconfig.build.json, or is
 *      named in EXEMPT — a package that forgets one must not go silently
 *      unscanned, since forgetting is the regression.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep, dirname, resolve } from 'node:path';
import ts from 'typescript';

const root = process.cwd();

/**
 * Workspaces that emit through tsc but deliberately have no tsconfig.build.json.
 * Every entry needs a reason: this is the escape hatch, so it is also the thing
 * most likely to be abused.
 */
export const EXEMPT = {
  'packages/i18n':
    'its `test` script is `pnpm build && node dist/*.test.js` — the compiled tests ARE the runner. Its dist is copied into no image; the web apps ship Next standalone output, which traces from entry points. If this package ever gains a vitest config, delete this entry and split it.',
};

/**
 * Rule 3 carve-outs: production modules that only a test currently imports.
 * These are NOT test code — excluding them from the build would be wrong. They
 * are modules with no production caller yet, which is a different smell worth
 * seeing rather than silencing wholesale.
 */
export const TEST_ONLY_ALLOWED = {
  'apps/api/src/modules/realtime/channels.ts':
    'the canonical Realtime channel-name contract (ARCHITECTURE.md §9.1). Clients build these names; no API code calls the helpers yet, so only its own test imports it. Production contract, not a test helper — do not exclude it from the build.',
};

const TEST_FILE = /\.(test|spec)\.tsx?$/;
const TEST_RUNNER = /^(vitest|@vitest\/.+|node:test|jest|@jest\/.+)$/;
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'coverage', '.next', '.turbo', 'build']);

export function isTestFile(path) {
  return TEST_FILE.test(path);
}

export function isTestRunnerSpecifier(specifier) {
  return TEST_RUNNER.test(specifier);
}

export function isRelativeSpecifier(specifier) {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

function toRepoPath(absolute) {
  return relative(root, absolute).split(sep).join('/');
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    if (IGNORED_DIRS.has(entry)) return [];
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

// ── Workspace discovery ──────────────────────────────────────────────────────

/**
 * The `packages:` globs from pnpm-workspace.yaml. Hand-parsed rather than
 * pulling in a YAML dependency — `yaml` does not resolve from the repo root.
 * Only the `- 'dir/*'` item form this repo uses is supported; anything else
 * throws rather than silently matching nothing.
 */
export function parseWorkspaceGlobs(yamlText) {
  const lines = yamlText.split(/\r?\n/);
  const start = lines.findIndex((line) => /^packages:\s*$/.test(line));
  if (start === -1) throw new Error('pnpm-workspace.yaml has no top-level `packages:` block');

  const globs = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // dedented out of the block
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s+-\s*['"]?([^'"#]+?)['"]?\s*$/.exec(line);
    if (!item) throw new Error(`unsupported pnpm-workspace.yaml packages entry: ${line}`);
    globs.push(item[1]);
  }
  if (!globs.length) throw new Error('pnpm-workspace.yaml `packages:` block is empty');
  return globs;
}

function expandWorkspaces(globs) {
  const dirs = [];
  for (const glob of globs) {
    const [parent, star] = glob.split('/');
    if (star !== '*') throw new Error(`unsupported workspace glob (expected "dir/*"): ${glob}`);
    const parentDir = join(root, parent);
    if (!existsSync(parentDir)) continue;
    for (const entry of readdirSync(parentDir)) {
      const dir = join(parentDir, entry);
      if (statSync(dir).isDirectory() && existsSync(join(dir, 'package.json'))) dirs.push(dir);
    }
  }
  return dirs.sort();
}

/** True when this workspace compiles with tsc, and so owns an emit surface. */
export function buildsWithTsc(buildScript) {
  if (!buildScript) return false;
  return /(^|\s|&)(tsc|nest build)\b/.test(buildScript);
}

/**
 * Workspace-relative source paths reachable from outside the package — the
 * `main`/`types`/`exports`/`bin` targets mapped from dist back to src.
 *
 * Rule 3 needs these: a package entry point is imported by every CONSUMING
 * workspace through the package name, which a relative-import graph cannot see.
 * Without this, `packages/time/src/index.ts` looks test-only.
 */
export function entryPointSources(manifest) {
  const specifiers = new Set();
  const collect = (value) => {
    if (typeof value === 'string') specifiers.add(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(manifest.main);
  collect(manifest.types);
  collect(manifest.exports);
  collect(manifest.bin);

  // Nest apps declare no `main`; the Dockerfile runs `node dist/main.js`.
  const sources = new Set(['src/main.ts', 'src/index.ts', 'src/index.tsx']);
  for (const specifier of specifiers) {
    const cleaned = specifier
      .replace(/^\.\//, '')
      .replace(/\.d\.ts$/, '')
      .replace(/\.(js|mjs|cjs)$/, '');
    if (!cleaned.startsWith('dist/')) continue;
    const stem = cleaned.slice('dist/'.length);
    sources.add(`src/${stem}.ts`);
    sources.add(`src/${stem}.tsx`);
    sources.add(`src/${stem}/index.ts`);
    sources.add(`src/${stem}/index.tsx`);
  }
  return sources;
}

// ── Import graph ─────────────────────────────────────────────────────────────

/**
 * Resolve a relative specifier the way Node/TS would for a .ts source tree.
 * `exists` is injected so this stays unit-testable without a filesystem.
 */
export function resolveRelativeImport(fromFile, specifier, exists) {
  const base = resolve(dirname(fromFile), specifier);
  const stripped = base.replace(/\.(js|mjs|cjs)$/, '');
  const candidates = [
    `${stripped}.ts`,
    `${stripped}.tsx`,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
    base,
  ];
  return candidates.find((candidate) => /\.tsx?$/.test(candidate) && exists(candidate)) ?? null;
}

function buildImportGraph(files) {
  const fileSet = new Set(files);
  const exists = (path) => fileSet.has(path) || existsSync(path);
  const imports = new Map();
  const bare = new Map();

  for (const file of files) {
    const { importedFiles } = ts.preProcessFile(readFileSync(file, 'utf8'), true, true);
    const resolved = new Set();
    const packages = new Set();
    for (const { fileName: specifier } of importedFiles) {
      if (isRelativeSpecifier(specifier)) {
        const target = resolveRelativeImport(file, specifier, exists);
        if (target) resolved.add(target);
      } else {
        packages.add(specifier);
      }
    }
    imports.set(file, resolved);
    bare.set(file, packages);
  }
  return { imports, bare };
}

/** Files that reach a test runner through any chain of relative imports. */
export function reachesTestRunner(files, imports, bare) {
  const direct = new Set(
    files.filter((file) => [...(bare.get(file) ?? [])].some(isTestRunnerSpecifier)),
  );
  // Propagate backwards: importing something tainted taints you too.
  let changed = true;
  while (changed) {
    changed = false;
    for (const file of files) {
      if (direct.has(file)) continue;
      for (const target of imports.get(file) ?? []) {
        if (direct.has(target)) {
          direct.add(file);
          changed = true;
          break;
        }
      }
    }
  }
  return direct;
}

/**
 * The rule set, pure so it can be unit-tested without a repo.
 *
 * @param emitFiles  absolute paths in the tsconfig.build.json program
 * @param allFiles   absolute paths of every source file in the workspace
 * @param imports    Map<file, Set<file>>
 * @param bare       Map<file, Set<specifier>>
 * @param entries    Set of absolute paths reachable from outside the package
 * @param allowed    repo-path -> reason, for rule 3
 */
export function findLeaks({
  emitFiles,
  allFiles,
  imports,
  bare,
  entries = new Set(),
  allowed = {},
  label = toRepoPath,
}) {
  const violations = [];
  const tainted = reachesTestRunner(emitFiles, imports, bare);

  for (const file of emitFiles) {
    // Rule 1 — a test file compiled into the shipped output.
    if (isTestFile(file)) {
      violations.push(`${label(file)}: test file is in the emit surface`);
      continue;
    }
    // Rule 2 — reaches a test runner. This one actually crashes in production.
    if (tainted.has(file)) {
      violations.push(`${label(file)}: emitted module reaches a test runner import`);
    }
  }

  // Rule 3 — a module only tests use.
  for (const file of emitFiles) {
    if (isTestFile(file) || entries.has(file)) continue;
    let fromTests = 0;
    let fromOthers = 0;
    for (const candidate of allFiles) {
      if (candidate === file || !imports.get(candidate)?.has(file)) continue;
      if (isTestFile(candidate)) fromTests += 1;
      else fromOthers += 1;
    }
    // Zero importers is normal — controllers wired by decorators, barrels,
    // entry points. Only "tests use it and nothing else does" is a leak.
    if (fromTests > 0 && fromOthers === 0 && !(label(file) in allowed)) {
      violations.push(
        `${label(file)}: imported by ${fromTests} test file(s) and nothing else — exclude it in tsconfig.build.json, or add a reasoned entry to TEST_ONLY_ALLOWED if it is production code with no caller yet`,
      );
    }
  }

  return violations;
}

// ── Per-workspace scan ───────────────────────────────────────────────────────

function parseBuildConfig(configPath) {
  const host = {
    useCaseSensitiveFileNames: false,
    readDirectory: ts.sys.readDirectory,
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    getCurrentDirectory: () => root,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, host);
  if (!parsed) throw new Error(`could not parse ${toRepoPath(configPath)}`);
  const errors = parsed.errors.filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) {
    const detail = errors
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
      .join('; ');
    throw new Error(`${toRepoPath(configPath)}: ${detail}`);
  }
  return parsed.fileNames.map((file) => resolve(file));
}

export function scanRepo() {
  const globs = parseWorkspaceGlobs(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'));
  const violations = [];
  const scanned = [];

  for (const dir of expandWorkspaces(globs)) {
    const repoDir = toRepoPath(dir);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    if (!buildsWithTsc(manifest.scripts?.build)) continue;

    const configPath = join(dir, 'tsconfig.build.json');
    if (!existsSync(configPath)) {
      // Rule 4.
      if (repoDir in EXEMPT) {
        scanned.push(`${repoDir}: exempt`);
        continue;
      }
      violations.push(
        `${repoDir}: builds with tsc but has no tsconfig.build.json — its tests compile into dist. Add one, or add a reasoned entry to EXEMPT in scripts/check-test-code-leak.mjs.`,
      );
      continue;
    }

    const emitFiles = parseBuildConfig(configPath);
    const allFiles = [...walk(join(dir, 'src')), ...walk(join(dir, 'test'))]
      .filter((file) => /\.tsx?$/.test(file) && !/\.d\.ts$/.test(file))
      .map((file) => resolve(file));
    const entries = new Set([...entryPointSources(manifest)].map((rel) => resolve(join(dir, rel))));

    const { imports, bare } = buildImportGraph([...new Set([...allFiles, ...emitFiles])]);
    violations.push(
      ...findLeaks({
        emitFiles,
        allFiles,
        imports,
        bare,
        entries,
        allowed: TEST_ONLY_ALLOWED,
      }),
    );
    scanned.push(`${repoDir}: ${emitFiles.length} emitted file(s)`);
  }

  if (!scanned.length) {
    throw new Error('no workspaces scanned — discovery is broken, not the repo clean');
  }
  return { violations, scanned };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
// Guarded so the test file can import the rules without running a scan.
const invokedDirectly = process.argv[1]?.endsWith('check-test-code-leak.mjs');
if (invokedDirectly) {
  const { violations, scanned } = scanRepo();
  if (violations.length) {
    console.error('Test code found in the compiled/shipped surface:');
    for (const violation of violations) console.error(`  - ${violation}`);
    console.error(
      '\nThe emit surface is what apps/api/Dockerfile copies into production, where\n' +
        'vitest is not installed. Exclude these in the workspace tsconfig.build.json.',
    );
    process.exit(1);
  }
  console.log(`No test code in the emit surface (${scanned.length} workspace(s) checked):`);
  for (const line of scanned) console.log(`  - ${line}`);
}
