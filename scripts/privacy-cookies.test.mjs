/**
 * The privacy policy's cookie table (§9), in both languages, against the cookies the code sets.
 *
 * Both ways: a cookie the code sets and the policy does not name fails, and so does a row
 * for a cookie nothing sets any more. The walk finds a cookie by its name's shape only: a
 * quoted literal (`'` or `"`, never a backtick, which comments use) that reads `mc_…`,
 * `sb-access-token` or `sb-refresh-token`, in non-test source of every app but the marketing
 * site (the policy must not vouch for itself) and every package.
 *
 * It reads SOURCE, not the built site, and lives here rather than in apps/web-marketing/test:
 * turbo caches that package's tests on its own files, so a cookie added in apps/api would be
 * served a cached green. `test:scripts` runs outside turbo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = [
  'apps/web-marketing/src/pages/privacypolicy.astro',
  'apps/web-marketing/src/pages/en/privacypolicy.astro',
];
const CODE_COOKIE = /['"](mc_[a-z_]+|sb-(?:access|refresh)-token)['"]/g;
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage']);

/**
 * Cookies whose name the walk cannot see: a library writes them under a name we hand it in
 * pieces. Each names the file that hands it over and what that file must still say, so a
 * client that changes or goes away fails here rather than leaving a stale row.
 */
const LIBRARY_COOKIES = [
  {
    // auth-js writes the Google sign-in's check as `<storageKey>-…-code-verifier`, and our
    // storage keeps only those keys (fix 477).
    name: 'mc-oauth-…-code-verifier',
    source: 'packages/api-client/src/oauth-storage.ts',
    mustContain: ["OAUTH_STORAGE_KEY = 'mc-oauth'", "'-code-verifier'"],
  },
];

function* sourceFiles(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* sourceFiles(join(dir, entry.name));
    } else if (EXTENSIONS.has(extname(entry.name)) && !/\.(test|spec)\./.test(entry.name)) {
      yield join(dir, entry.name);
    }
  }
}

function sourceRoots() {
  const apps = readdirSync(join(ROOT, 'apps')).filter((app) => app !== 'web-marketing');
  const packages = readdirSync(join(ROOT, 'packages'));
  return [
    ...apps.flatMap((app) => [join(ROOT, 'apps', app, 'src'), join(ROOT, 'apps', app, 'app')]),
    ...packages.map((pkg) => join(ROOT, 'packages', pkg, 'src')),
  ];
}

function codeCookieNames() {
  const names = new Set();
  for (const root of sourceRoots()) {
    for (const file of sourceFiles(root)) {
      for (const match of readFileSync(file, 'utf8').matchAll(CODE_COOKIE)) names.add(match[1]);
    }
  }
  return [...names];
}

/** The first cell of each row of §9's first table: the cookie names the policy lists. */
function policyCookieNames(page) {
  const source = readFileSync(join(ROOT, page), 'utf8');
  const start = source.indexOf('<!-- 9 -->');
  const end = source.indexOf('<!-- 10 -->');
  assert.ok(start >= 0 && end > start, `${page}: §9 is not between <!-- 9 --> and <!-- 10 -->`);
  const section = source.slice(start, end);
  const table = section.slice(section.indexOf('<table>'), section.indexOf('</table>'));
  assert.ok(table.length > 0, `${page}: §9 has no table`);
  return [...table.matchAll(/<tr><td><code>([^<]+)<\/code><\/td>/g)].map((match) => match[1]);
}

test('the policy names every cookie the code sets, in both languages', () => {
  for (const cookie of LIBRARY_COOKIES) {
    const file = join(ROOT, cookie.source);
    assert.ok(existsSync(file), `${cookie.name}: ${cookie.source} is gone`);
    const text = readFileSync(file, 'utf8');
    for (const needle of cookie.mustContain) {
      assert.ok(text.includes(needle), `${cookie.name}: ${cookie.source} no longer says ${needle}`);
    }
  }
  const codeNames = codeCookieNames();
  assert.ok(codeNames.length >= 7, `the walk found only ${codeNames.length} cookie names`);
  const expected = [...codeNames, ...LIBRARY_COOKIES.map((cookie) => cookie.name)].sort();
  for (const page of PAGES) {
    assert.deepEqual(policyCookieNames(page).sort(), expected, `${page}: §9's cookie table`);
  }
});

test('both pages carry the photos section the photo forms link to', () => {
  for (const page of PAGES) {
    const source = readFileSync(join(ROOT, page), 'utf8');
    assert.equal(source.split('<h2 id="photos">').length - 1, 1, `${page}: <h2 id="photos">`);
  }
});
