/**
 * Reading the *built* site in dist/, shared by the contract tests
 * (site.test.mjs, guide.test.mjs). Not a test file: `test/*.test.mjs` skips it.
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const DIST = resolve(HERE, '..', 'dist');

/** Every .html file under dist/, as repo-relative-ish route + contents. */
export function htmlFiles(dir = DIST, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) htmlFiles(full, acc);
    else if (entry.endsWith('.html')) acc.push(full);
  }
  return acc;
}

/** `dist/terms/index.html` -> `/terms`, `dist/index.html` -> `/`. */
export function routeOf(file) {
  const rel = relative(DIST, file).split('\\').join('/');
  const withoutIndex = rel.replace(/(^|\/)index\.html$/u, '$1').replace(/\.html$/u, '');
  const route = `/${withoutIndex}`.replace(/\/+$/u, '');
  return route === '' ? '/' : route;
}

/** route → HTML of every built page, after checking the build ran at all. */
export function loadPages() {
  assert.ok(
    existsSync(DIST),
    'dist/ is missing — run `pnpm --filter @myclash/web-marketing build` first.',
  );
  return new Map(htmlFiles().map((file) => [routeOf(file), readFileSync(file, 'utf8')]));
}
