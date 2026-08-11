/**
 * Contract tests over the *built* site in dist/.
 *
 * The marketing app sat outside every gate for its whole life — `build`,
 * `lint`, `typecheck` and `test` were all `echo noop`, and `format:check` does
 * not glob html. That is why a Caddy SPA fallback could serve the homepage in
 * place of both legal documents for months without anything noticing. These
 * assertions are the floor that stops it recurring.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, '..', 'dist');
const REPO_ROOT = resolve(HERE, '..', '..', '..');

/** Every .html file under dist/, as repo-relative-ish route + contents. */
function htmlFiles(dir = DIST, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) htmlFiles(full, acc);
    else if (entry.endsWith('.html')) acc.push(full);
  }
  return acc;
}

/** `dist/terms/index.html` -> `/terms`, `dist/index.html` -> `/`. */
function routeOf(file) {
  const rel = relative(DIST, file).split('\\').join('/');
  const withoutIndex = rel.replace(/(^|\/)index\.html$/u, '$1').replace(/\.html$/u, '');
  const route = `/${withoutIndex}`.replace(/\/+$/u, '');
  return route === '' ? '/' : route;
}

let pages;

before(() => {
  assert.ok(
    existsSync(DIST),
    'dist/ is missing — run `pnpm --filter @myclash/web-marketing build` first.',
  );
  pages = new Map(htmlFiles().map((file) => [routeOf(file), readFileSync(file, 'utf8')]));
  assert.ok(pages.size >= 7, `expected at least 7 built pages, found ${pages.size}`);
});

const titleOf = (html) => /<title>([^<]*)<\/title>/u.exec(html)?.[1] ?? '';

test('every path published by LEGAL_POLICIES resolves to its own document', () => {
  /*
   * Read the paths out of packages/types/src/legal.ts rather than hardcoding
   * them. Those are the URLs the in-app consent links and LegalUpdateBanner are
   * built from; hardcoding `/terms` here would let the two drift apart and
   * still pass, which is precisely the failure this guards.
   */
  const legal = readFileSync(join(REPO_ROOT, 'packages', 'types', 'src', 'legal.ts'), 'utf8');
  const paths = [
    ...legal.matchAll(/path:\s*\{\s*en:\s*'([^']+)',\s*fr:\s*'([^']+)'\s*\}/gu),
  ].flatMap(([, en, fr]) => [en, fr]);

  assert.ok(paths.length >= 4, `expected 4 legal paths from legal.ts, parsed ${paths.length}`);

  const homeTitle = titleOf(pages.get('/'));
  for (const path of paths) {
    const html = pages.get(path);
    assert.ok(html, `LEGAL_POLICIES publishes ${path} but the build emits no such page`);
    const title = titleOf(html);
    assert.notEqual(
      title,
      homeTitle,
      `${path} renders the homepage ("${title}") instead of its own document`,
    );
    assert.match(
      title,
      /terms|conditions|privacy|confidentialit/iu,
      `${path} has an unexpected title: "${title}"`,
    );
  }
});

test('no page loads a subresource from another host', () => {
  /*
   * The standing guard for the Google Fonts finding: fonts.googleapis.com and
   * fonts.gstatic.com received every visitor's IP on every page, including on
   * the privacy policy whose §8 undertakes to name every flow that leaves the
   * EU. Outbound *links* are fine — this only rejects things the browser
   * fetches on its own.
   */
  const SUBRESOURCE = /<(?:script|img|source|iframe|embed)\b[^>]*\bsrc="([^"]+)"/giu;
  const STYLESHEET =
    /<link\b[^>]*\brel="(?:stylesheet|preload|preconnect|modulepreload)"[^>]*\bhref="([^"]+)"/giu;
  const SRCSET = /\bsrcset="([^"]+)"/giu;

  for (const [route, html] of pages) {
    const urls = [
      ...[...html.matchAll(SUBRESOURCE)].map((m) => m[1]),
      ...[...html.matchAll(STYLESHEET)].map((m) => m[1]),
      ...[...html.matchAll(SRCSET)].flatMap((m) =>
        m[1].split(',').map((candidate) => candidate.trim().split(/\s+/u)[0]),
      ),
    ];
    for (const url of urls) {
      assert.ok(
        !/^(?:https?:)?\/\//u.test(url),
        `${route} loads a cross-origin subresource: ${url}`,
      );
    }
  }
});

test('every internal link resolves to something the build emitted', () => {
  const assets = new Set(htmlFiles().map(routeOf));
  // Everything else that got emitted (images, fonts, css, robots.txt…).
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files.push('/' + relative(DIST, full).split('\\').join('/'));
    }
  })(DIST);
  const emitted = new Set([...assets, ...files]);

  for (const [route, html] of pages) {
    const hrefs = [...html.matchAll(/\bhref="([^"]+)"/gu)].map((m) => m[1]);
    for (const href of hrefs) {
      if (/^(?:https?:|mailto:|tel:|#|data:)/u.test(href)) continue;
      const path = href.split('#')[0].split('?')[0].replace(/\/$/u, '') || '/';
      assert.ok(
        emitted.has(path) || emitted.has(`${path}/index.html`),
        `${route} links to ${href}, which the build does not emit`,
      );
    }
  }
});

test('French and English pages expose the same section anchors', () => {
  /*
   * Structural parity. The two landing pages were separate 43 KB HTML files
   * that had already drifted; this asserts they cannot again.
   */
  const idsOf = (html) => new Set([...html.matchAll(/\bid="([^"]+)"/gu)].map((m) => m[1]));
  const fr = idsOf(pages.get('/'));
  const en = idsOf(pages.get('/en'));
  assert.deepEqual(
    [...fr].sort(),
    [...en].sort(),
    'the FR and EN landing pages do not expose the same element ids',
  );
});

test('page content is in the HTML, not injected by script', () => {
  /*
   * The scroll-reveal animation used to start every feature card and step at
   * `opacity: 0` and rely on an IntersectionObserver to un-hide them, so with
   * JavaScript off both sections rendered blank. The start state is now gated
   * behind a `.js` class. Assert the prose is present in the served markup —
   * a crawler or a reader without JS sees the same words.
   */
  /*
   * Expected counts come from the copy table, not from a number typed here.
   * A literal 6 had to be edited the moment the feature list grew, which means
   * it was pinning the test's own fixture rather than the page.
   */
  const copy = readFileSync(join(HERE, '..', 'src', 'i18n', 'home.ts'), 'utf8');
  const expected = (block) => {
    const section =
      new RegExp(`\\n  ${block}: \\[([\\s\\S]*?)\\n  \\],`, 'u').exec(copy)?.[1] ?? '';
    return [...section.matchAll(/^\s{4}\{/gmu)].length;
  };
  const expectedFeatures = expected('features');
  const expectedSteps = expected('steps');
  assert.ok(expectedFeatures >= 6, `parsed ${expectedFeatures} features from home.ts`);
  assert.ok(expectedSteps >= 3, `parsed ${expectedSteps} steps from home.ts`);

  for (const route of ['/', '/en']) {
    const html = pages.get(route);
    const body = html.slice(html.indexOf('<body'));
    assert.ok(
      !/opacity:\s*0/u.test(body),
      `${route} carries an inline opacity:0 on rendered content`,
    );
    const cards = [...body.matchAll(/class="feature-card"/gu)].length;
    assert.equal(
      cards,
      expectedFeatures,
      `${route} should render every feature card server-side, saw ${cards}`,
    );
    const steps = [...body.matchAll(/class="step"/gu)].length;
    assert.equal(
      steps,
      expectedSteps,
      `${route} should render every step server-side, saw ${steps}`,
    );
  }
});

test('the stats band ships empty and is filled from the API, never prefilled', () => {
  /*
   * The three figures here were 120 / 45 / 3 000, hardcoded and untrue. Server
   * rendering any digit into the band would reintroduce that, so the markup
   * must contain no number and must start hidden — the script reveals it only
   * once real counts arrive.
   */
  for (const route of ['/', '/en']) {
    const html = pages.get(route);
    const band = /<section class="stats"[^>]*>([\s\S]*?)<\/section>/u.exec(html);
    assert.ok(band, `${route} has no stats band`);
    assert.match(band[0], /\bhidden\b/u, `${route} stats band does not start hidden`);

    const numbers = [...band[1].matchAll(/<div class="stat__number"[^>]*>([\s\S]*?)<\/div>/gu)];
    assert.ok(numbers.length >= 3, `${route} stats band has ${numbers.length} slots`);
    for (const [, contents] of numbers) {
      assert.ok(
        !/\d/u.test(contents),
        `${route} server-renders a figure into the stats band: ${contents.trim()}`,
      );
    }
  }

  /*
   * `hidden` alone is not enough. The band is `display: grid`, and any explicit
   * display in our own CSS beats the UA stylesheet's `[hidden] { display: none }` —
   * so with the attribute set correctly the band still occupied the page as an
   * empty blue bar. Assert the override that actually makes `hidden` mean hidden.
   */
  const css = [...pages.get('/').matchAll(/href="(\/_astro\/[^"]+\.css)"/gu)].map((m) => m[1]);
  assert.ok(css.length > 0, 'the landing page links no stylesheet');
  const bundled = css.map((href) => readFileSync(join(DIST, href), 'utf8')).join('\n');
  assert.match(
    bundled.replace(/\s+/gu, ''),
    /\[hidden\]\{display:none!important\}/u,
    'the [hidden] display override is missing — a hidden stats band would still take up space',
  );
});

test('each page declares a canonical and both hreflang alternates', () => {
  for (const [route, html] of pages) {
    if (route === '/404') continue;
    assert.match(
      html,
      /<link rel="canonical" href="https:\/\/myclash\.fr[^"]*">/u,
      `${route} canonical`,
    );
    assert.match(html, /hreflang="fr"/u, `${route} is missing its fr alternate`);
    assert.match(html, /hreflang="en"/u, `${route} is missing its en alternate`);
  }
});

test('the landing page stays within its first-paint budget', () => {
  /*
   * `pnpm perf:bundle` weighs emitted .js files, and Astro inlines this site's
   * few kilobytes of script straight into the HTML — so that budget correctly
   * reports zero files and guards nothing here. What can actually regress is
   * total first-paint weight, which is the thing that was wrong: the page used
   * to ship ~4.7 MB of unoptimised PNG, with a 2.37 MB hero as a CSS
   * background that could not even be preloaded.
   *
   * Measured: the document, every stylesheet it links, and the smallest hero
   * candidate the srcset offers (what a phone actually fetches).
   */
  const html = pages.get('/');
  const gz = (buffer) => gzipSync(buffer, { level: 9 }).byteLength;

  let total = gz(Buffer.from(html));

  for (const [, href] of html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/gu)) {
    total += gz(readFileSync(join(DIST, href)));
  }

  const heroCandidates = [...html.matchAll(/\/_astro\/Hero_myclash[^\s",]+\.avif/gu)].map(
    (m) => statSync(join(DIST, m[0])).size,
  );
  assert.ok(heroCandidates.length > 0, 'no AVIF hero candidates were emitted');
  total += Math.min(...heroCandidates);

  const budget = 250 * 1024;
  assert.ok(
    total <= budget,
    `first paint is ${Math.round(total / 1024)} KB, above the ${budget / 1024} KB budget`,
  );
  console.log(`    first paint (mobile): ${Math.round(total / 1024)} KB of ${budget / 1024} KB`);
});
