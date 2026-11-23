/**
 * Contract tests for the organiser guide, over the built site in dist/
 * (docs/superpowers/specs/2026-11-18-organiser-guide-design.md).
 * One Markdown file per page per language, under src/content/guide/{fr,en}.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { HERE, DIST, loadPages } from './built-site.mjs';

const GUIDE_SRC = join(HERE, '..', 'src', 'content', 'guide');

let pages;

before(() => {
  pages = loadPages();
});

const guideRoutes = (prefix) =>
  [...pages.keys()].filter((r) => r === prefix || r.startsWith(`${prefix}/`));

test('guide pages exist in both languages, one per Markdown file', () => {
  const fr = guideRoutes('/guide');
  const en = guideRoutes('/en/guide').map((r) => r.slice(3));
  const frFiles = readdirSync(join(GUIDE_SRC, 'fr')).filter((f) => f.endsWith('.md'));
  const enFiles = readdirSync(join(GUIDE_SRC, 'en')).filter((f) => f.endsWith('.md'));
  assert.deepEqual(enFiles.sort(), frFiles.sort(), 'the FR and EN guide sources differ');
  assert.ok(frFiles.length >= 2, `expected at least the index and page 0, found ${frFiles.length}`);
  assert.equal(fr.length, frFiles.length, 'a French guide source built no page');
  assert.deepEqual(en.sort(), fr.sort(), 'the FR and EN guides do not build the same pages');
});

test('a guide page has the same order and section in both languages', () => {
  // `order` drives the "Next step" chain and `section` the contents groups; a page
  // placed differently in one language would send its readers another route.
  const placeOf = (locale) =>
    Object.fromEntries(
      readdirSync(join(GUIDE_SRC, locale))
        .filter((f) => f.endsWith('.md'))
        .map((f) => {
          const front = readFileSync(join(GUIDE_SRC, locale, f), 'utf8');
          return [
            f,
            {
              order: Number(/^order:\s*(-?\d+)\s*$/mu.exec(front)?.[1]),
              section: /^section:\s*(\w+)\s*$/mu.exec(front)?.[1],
            },
          ];
        }),
    );
  assert.deepEqual(placeOf('en'), placeOf('fr'), 'a page has a different place in EN and FR');
});

/** The section labels, read from the copy table so a renamed label cannot drift from the test. */
const SECTION_KEYS = [
  'guideSectionAbout',
  'guideSectionSteps',
  'guideSectionConcepts',
  'guideSectionDay',
  'guideSectionBeyond',
  'guideSectionAround',
];
const sectionLabels = (locale) => {
  const ui = readFileSync(join(HERE, '..', 'src', 'i18n', 'ui.ts'), 'utf8');
  const block = ui.slice(ui.indexOf(`  ${locale}: {`));
  return SECTION_KEYS.map((key) => new RegExp(`${key}: '([^']+)'`, 'u').exec(block)?.[1]);
};

test('the contents list groups pages by section, in reading order', () => {
  for (const [locale, route] of [
    ['fr', '/guide'],
    ['en', '/en/guide'],
  ]) {
    const html = pages.get(route);
    const toc = /<nav class="guide-toc guide-toc--wide"[\s\S]*?<\/nav>/u.exec(html)?.[0] ?? '';
    const headings = [...toc.matchAll(/class="guide-toc__section"[^>]*>([^<]+)</gu)].map((m) =>
      m[1].trim(),
    );
    const expected = sectionLabels(locale);
    assert.ok(expected.every(Boolean), `${route}: the copy table lost a section label`);
    assert.deepEqual(headings, expected, `${route}: section headings missing or out of order`);
  }
});

test('printing a guide page hides the site chrome', () => {
  // Astro links large stylesheets and inlines small ones: read both.
  const html = pages.get('/guide');
  const css = [
    ...[...html.matchAll(/href="(\/_astro\/[^"]+\.css)"/gu)].map(([, href]) =>
      readFileSync(join(DIST, href), 'utf8'),
    ),
    ...[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gu)].map(([, inline]) => inline),
  ]
    .join('\n')
    .replace(/\s+/gu, '');
  const print = /@mediaprint\{([\s\S]*?\})\}/u.exec(css)?.[1] ?? '';
  assert.ok(print, 'no @media print block reaches the guide pages');
  const hidden = new Set(
    [...print.matchAll(/([^{}]+)\{([^}]*)\}/gu)]
      .filter(([, , body]) => /display:none/u.test(body))
      .flatMap(([, selectors]) => selectors.split(',')),
  );
  for (const selector of ['.nav', '.footer', '.guide-toc', '.guide-next']) {
    assert.ok(hidden.has(selector), `printing still shows ${selector}`);
  }
});

test('every guide page but the last links to the next one', () => {
  for (const prefix of ['/guide', '/en/guide']) {
    const routes = guideRoutes(prefix);
    const withNext = routes.filter((r) => /class="guide-next"/u.test(pages.get(r)));
    assert.equal(withNext.length, routes.length - 1, `${prefix}: next-step links`);
  }
});

test('every image on a guide page was emitted', () => {
  for (const route of [...guideRoutes('/guide'), ...guideRoutes('/en/guide')]) {
    const html = pages.get(route);
    const srcs = [
      ...[...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gu)].map((m) => m[1]),
      ...[...html.matchAll(/\bsrcset="([^"]+)"/gu)].flatMap((m) =>
        m[1].split(',').map((c) => c.trim().split(/\s+/u)[0]),
      ),
    ];
    for (const src of srcs) {
      assert.ok(existsSync(join(DIST, src.split('?')[0])), `${route} shows ${src}, not in dist/`);
    }
  }
});

test('the sitemap lists every guide page', () => {
  const sitemap = readdirSync(DIST)
    .filter((f) => /^sitemap-\d+\.xml$/u.test(f))
    .map((f) => readFileSync(join(DIST, f), 'utf8'))
    .join('\n');
  const routes = [...guideRoutes('/guide'), ...guideRoutes('/en/guide')];
  assert.ok(routes.length > 0, 'no guide page was built');
  for (const route of routes) {
    assert.ok(sitemap.includes(`https://myclash.fr${route}<`), `sitemap misses ${route}`);
  }
});

test('the nav links to the guide in each language', () => {
  assert.match(pages.get('/'), /<nav[\s\S]*?href="\/guide"[\s\S]*?<\/nav>/u);
  assert.match(pages.get('/en'), /<nav[\s\S]*?href="\/en\/guide"[\s\S]*?<\/nav>/u);
});
