/**
 * Every workspace package that runs vitest keeps its own module cache (ruling 174, `8ea41b55`).
 *
 * Vitest 5 caches transformed modules in ONE folder for the whole workspace and deletes it when
 * the lockfile changes. `pnpm test` starts about a dozen vitest runs at once, so after a
 * dependency bump they all delete the same folder and one loses the race (ENOTEMPTY), and turbo
 * stops the run. Each config therefore sets `test.fsModuleCachePath` to the package's own
 * `node_modules/.vitest-cache`. This test fails when a package that runs vitest has no config,
 * or a config without that value, so a new package cannot bring the shared cache back.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OWN_CACHE = 'node_modules/.vitest-cache';

/** The `packages:` globs of pnpm-workspace.yaml, up to the next top-level key; blank and
 *  comment lines inside the list are skipped. Only `<dir>/*` is understood: any other glob, or
 *  any other indented line, fails here, so nothing can hide packages from this test. */
function workspaceGlobs() {
  const lines = readFileSync(join(REPO, 'pnpm-workspace.yaml'), 'utf8').split(/\r?\n/u);
  const start = lines.indexOf('packages:');
  assert.notEqual(start, -1, 'pnpm-workspace.yaml has no "packages:" list');
  const globs = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/u.test(line)) continue;
    if (!/^\s/u.test(line)) break;
    const item = /^\s+-\s+['"]?([^'"]+)['"]?\s*$/u.exec(line);
    assert.ok(item, `unsupported line in the packages list: ${line}`);
    assert.match(item[1], /^[\w.-]+\/\*$/u, `unsupported workspace glob: ${item[1]}`);
    globs.push(item[1]);
  }
  assert.ok(globs.length > 0, 'pnpm-workspace.yaml lists no package glob');
  return globs;
}

/** Workspace packages (a matched folder with a package.json, as pnpm counts them) whose scripts
 *  run vitest. */
function packagesRunningVitest() {
  const found = [];
  for (const glob of workspaceGlobs()) {
    const parent = glob.slice(0, -2);
    for (const entry of readdirSync(join(REPO, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = `${parent}/${entry.name}`;
      const manifest = join(REPO, dir, 'package.json');
      if (!existsSync(manifest)) continue;
      const scripts = JSON.parse(readFileSync(manifest, 'utf8')).scripts ?? {};
      if (Object.values(scripts).some((script) => /\bvitest\b/u.test(String(script)))) {
        found.push(dir);
      }
    }
  }
  return found;
}

/** The config object a vitest.config.ts exports. Imported from this ES module, tsx gives it as
 *  `default` (from `node -e` it would sit one `default` deeper): the shape check below fails
 *  loudly if that ever changes, rather than reading as a missing key. */
async function vitestConfig(dir) {
  const path = join(REPO, dir, 'vitest.config.ts');
  assert.ok(existsSync(path), `${dir} runs vitest but has no vitest.config.ts`);
  const config = (await import(pathToFileURL(path).href)).default;
  assert.ok(
    config !== null && typeof config === 'object' && 'test' in config,
    `${dir}/vitest.config.ts: no exported config with a "test" block`,
  );
  return config;
}

test('the packages that run vitest are found', () => {
  const packages = packagesRunningVitest();
  for (const expected of ['apps/api', 'packages/ui']) {
    assert.ok(packages.includes(expected), `${expected} not found among ${packages.join(', ')}`);
  }
});

test('every package that runs vitest keeps its own module cache', async () => {
  for (const dir of packagesRunningVitest()) {
    const config = await vitestConfig(dir);
    assert.equal(config.test.fsModuleCachePath, OWN_CACHE, `${dir}/vitest.config.ts`);
  }
});
