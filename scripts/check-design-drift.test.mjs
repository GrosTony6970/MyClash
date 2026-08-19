import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  APPS,
  checkAppWiring,
  checkColors,
  checkDesignParsed,
  checkFonts,
  checkThemeParsed,
  fontKeysOf,
  gate,
  parseDesignMd,
  parseTheme,
  readAppWiring,
} from './check-design-drift.mjs';

const themeCss = (body) => `@theme {\n${body}\n}`;
const scopesOf = (css) => parseTheme(css);
const designMd = (frontMatter) => `---\n${frontMatter}\n---\n\n# Design\n`;

// ── Parsing theme.css ────────────────────────────────────────────────────────

test('the header comment is stripped before any block is located', () => {
  // theme.css documents its own scopes in prose ("[data-theme='dark'] → dark
  // SURFACE tokens"). A naive indexOf matches that sentence and then
  // brace-matches whatever block follows it, parsing the base scope three times.
  const css = `/* [data-theme='dark'] means the dark surface tokens */
    @theme { --color-bg: #fff; }
    [data-theme='dark'] { --color-bg: #000; }
    [data-accent='personal'] { --color-accent: #111; }`;

  const { base, dark, personal } = parseTheme(css);

  assert.equal(base.get('--color-bg'), '#fff');
  assert.equal(dark.get('--color-bg'), '#000');
  assert.equal(personal.get('--color-accent'), '#111');
});

test('the font vars theme.css defers to next/font are collected once each', () => {
  const css = themeCss(
    '--font-display: var(--font-fraunces), Georgia;\n--font-body: var(--font-geist), sans-serif;',
  );

  assert.deepEqual(parseTheme(css).referenced, ['--font-fraunces', '--font-geist']);
});

test('a scope that will not parse is a finding, one per scope', () => {
  const findings = checkThemeParsed(parseTheme('/* nothing here */'));

  assert.equal(findings.length, 3);
  assert.match(findings[0], /could not parse the @theme block/);
  assert.match(findings[1], /could not parse the \[data-theme='dark'\] block/);
  assert.match(findings[2], /could not parse the \[data-accent='personal'\] block/);
});

// ── Parsing DESIGN.md ────────────────────────────────────────────────────────

test('a document with no front matter is a finding, not a process exit', () => {
  // This branch used to call process.exit(1) directly, which skips the harness
  // and every piece of cleanup a gate might own.
  const parsed = parseDesignMd('# Design\n\nNo front matter at all.\n');

  assert.equal(parsed.frontMatter, null);
  assert.deepEqual(checkDesignParsed(parsed), ['DESIGN.md: no YAML front matter found.']);
});

test('front matter with neither map is two findings', () => {
  const findings = checkDesignParsed(parseDesignMd(designMd('title: Design')));

  assert.deepEqual(findings, [
    'DESIGN.md: could not parse the colors map.',
    'DESIGN.md: could not parse the typography map.',
  ]);
});

test('the colors map stops at the next top-level key', () => {
  const { colors } = parseDesignMd(
    designMd("colors:\n  bg: '#fff'\n  fg: '#000'\nspacing:\n  sm: '4px'"),
  );

  assert.deepEqual(
    [...colors],
    [
      ['bg', '#fff'],
      ['fg', '#000'],
    ],
  );
});

test('a fontFamily belongs to the key it sits under', () => {
  // The check used to search the whole document, so it passed on an occurrence
  // anywhere. DESIGN.md reuses the display stack in h1 and h2, which meant
  // deleting the display entry outright left this gate green — the check could
  // not fail for the one edit it exists to catch.
  const { fonts } = parseDesignMd(
    designMd(
      'typography:\n  display:\n    fontFamily: "Fraunces, Georgia"\n' +
        '  h1:\n    fontFamily: "Fraunces, Georgia"',
    ),
  );

  assert.equal(fonts.get('display'), 'Fraunces, Georgia');
  assert.equal(fonts.get('h1'), 'Fraunces, Georgia');
  assert.equal(fonts.get('body'), undefined);
});

// ── Colours ──────────────────────────────────────────────────────────────────

const colourScopes = scopesOf(`@theme { --color-bg: #ffffff; --color-accent: #2563eb; }
  [data-theme='dark'] { --color-bg: #0b0b0c; }
  [data-accent='personal'] { --color-accent: #7c3aed; --color-accent-hover: #6d28d9; }`);

test('a value DESIGN.md gets wrong is named with both sides', () => {
  const { findings } = checkColors(new Map([['bg', '#eeeeee']]), colourScopes);

  assert.equal(findings.length, 2); // the mismatch, plus accent being undocumented
  assert.equal(
    findings[0],
    'DESIGN.md colors.bg: says #eeeeee, but packages/ui/src/theme.css base has --color-bg: #ffffff.',
  );
});

test('a token DESIGN.md invented is named', () => {
  const designColors = new Map([
    ['bg', '#ffffff'],
    ['accent', '#2563eb'],
    ['ghost', '#123456'],
  ]);

  const { findings } = checkColors(designColors, colourScopes);

  assert.equal(findings.length, 1);
  assert.match(findings[0], /colors\.ghost: no --color-ghost in the base scope/);
});

test('a dark- key is compared against the dark scope, not the base one', () => {
  const designColors = new Map([
    ['bg', '#ffffff'],
    ['accent', '#2563eb'],
    ['dark-bg', '#0b0b0c'],
  ]);

  assert.deepEqual(checkColors(designColors, colourScopes).findings, []);
  assert.match(
    checkColors(new Map([...designColors, ['dark-bg', '#ffffff']]), colourScopes).findings[0],
    /colors\.dark-bg: says #ffffff, but .* dark has --color-bg: #0b0b0c/,
  );
});

test('the two personal-accent keys route to the personal scope', () => {
  const designColors = new Map([
    ['bg', '#ffffff'],
    ['accent', '#2563eb'],
    ['accent-personal', '#7c3aed'],
    ['accent-personal-hover', '#6d28d9'],
  ]);

  assert.deepEqual(checkColors(designColors, colourScopes).findings, []);
});

test('an alias ref mirrors nothing, so it is neither checked nor counted', () => {
  const withAlias = new Map([
    ['bg', '#ffffff'],
    ['accent', '#2563eb'],
    ['primary', '{colors.accent}'],
  ]);

  const { findings, compared } = checkColors(withAlias, colourScopes);

  assert.deepEqual(findings, []);
  // 2 forward (bg, accent) + 2 reverse (--color-bg, --color-accent). The alias
  // contributes to neither: counting it would inflate the anti-vacuity number
  // with an assertion nobody made.
  assert.equal(compared, 4);
});

test('a token theme.css defines but DESIGN.md never documents is a finding', () => {
  const { findings } = checkColors(new Map([['bg', '#ffffff']]), colourScopes);

  assert.ok(
    findings.some((f) =>
      /theme\.css defines --color-accent but DESIGN\.md does not document colors\.accent/.test(f),
    ),
  );
});

// ── Fonts ────────────────────────────────────────────────────────────────────

const fontBase = (body) => parseTheme(themeCss(body)).base;

test('the font keys are derived from theme.css, so a fourth stack is compared too', () => {
  // As a hardcoded ['display', 'body', 'mono'] this loop could not see a new
  // stack, and the count it reported was a constant either way.
  const base = fontBase(
    '--font-display: var(--font-a), Georgia;\n' +
      '--font-body: var(--font-b), sans-serif;\n' +
      '--font-mono: var(--font-c), monospace;\n' +
      '--font-numeric: var(--font-d), tabular;',
  );

  assert.deepEqual(fontKeysOf(base), ['display', 'body', 'mono', 'numeric']);
  assert.equal(checkFonts(base, new Map()).compared, 4);
});

test('a stack with no var() indirection cannot be supplied by next/font', () => {
  const { findings } = checkFonts(fontBase("--font-display: 'Fraunces', Georgia;"), new Map());

  assert.equal(findings.length, 1);
  assert.match(findings[0], /expected a var\(--font-\*\) indirection/);
});

test('a stack with no fallbacks renders in the browser default until next/font arrives', () => {
  const base = fontBase('--font-display: var(--font-fraunces);');

  const { findings } = checkFonts(base, new Map([['display', 'Fraunces']]));

  assert.equal(findings.length, 1);
  assert.match(findings[0], /names no fallback families after the var\(\) indirection/);
});

test('a stack DESIGN.md never declares is a finding', () => {
  const base = fontBase('--font-display: var(--font-fraunces), Georgia;');

  const { findings } = checkFonts(base, new Map());

  assert.deepEqual(findings, [
    'DESIGN.md: typography.display declares no fontFamily to compare with packages/ui/src/theme.css.',
  ]);
});

test('the documented stack must mention the first fallback', () => {
  const base = fontBase("--font-display: var(--font-fraunces), 'Iowan Old Style', Georgia;");

  assert.match(
    checkFonts(base, new Map([['display', 'Fraunces, Georgia']])).findings[0],
    /typography\.display: does not mention the "Iowan Old Style" fallback/,
  );
  assert.deepEqual(
    checkFonts(base, new Map([['display', "Fraunces, 'Iowan Old Style', Georgia"]])).findings,
    [],
  );
});

// ── App wiring ───────────────────────────────────────────────────────────────

test('an app importing the theme but not defining the font var is a finding', () => {
  const load = () => "import { Fraunces } from 'next/font/google';";

  const { findings, wired, compared } = checkAppWiring(
    ['apps/web-staff'],
    ['--font-fraunces', '--font-geist'],
    load,
  );

  assert.equal(wired, 1);
  assert.equal(compared, 2);
  assert.equal(findings.length, 2);
  assert.match(findings[0], /never defines --font-fraunces/);
  assert.match(findings[0], /correct colours in a fallback font/);
});

test('an app that declares the var, in either quote style, is wired', () => {
  const single = () => "variable: '--font-geist'";
  const double = () => 'variable: "--font-geist"';

  assert.deepEqual(checkAppWiring(['a'], ['--font-geist'], single).findings, []);
  assert.deepEqual(checkAppWiring(['a'], ['--font-geist'], double).findings, []);
});

test('an app that does not use the theme is skipped, and counted nowhere', () => {
  // The summary line used to say `${APPS.length} apps wired`, so it claimed
  // three even when all three had been skipped here.
  const { findings, wired, compared } = checkAppWiring(['a', 'b'], ['--font-geist'], () => null);

  assert.deepEqual(findings, []);
  assert.equal(wired, 0);
  assert.equal(compared, 0);
});

// ── Anti-vacuity against the real repo ───────────────────────────────────────

test('every app in APPS still resolves to a theme-importing layout', () => {
  // The per-app floor. A renamed app directory makes readAppWiring return null,
  // which the gate treats as "does not use the theme" — so the comparison count
  // shrinks and nothing goes red. This is what notices.
  assert.equal(APPS.length, 3, 'an app was dropped from the list, not just renamed');
  for (const app of APPS) {
    assert.notEqual(readAppWiring(app), null, `${app} no longer resolves to a wired layout`);
  }
});

test('the reported comparison count is the sum of the comparisons actually made', () => {
  // A floor like `scanned > 100` would accept a hardcoded 101, which is the
  // same vacuity this gate exists to close. Recompute the parts and require
  // the whole to equal them.
  const theme = parseTheme(readFileSync('packages/ui/src/theme.css', 'utf8'));
  const design = parseDesignMd(readFileSync('DESIGN.md', 'utf8'));
  const expected =
    checkColors(design.colors, theme).compared +
    checkFonts(theme.base, design.fonts).compared +
    checkAppWiring(APPS, theme.referenced).compared;

  const result = gate.run({ argv: [] });

  assert.equal(result.scanned, expected);
  assert.ok(expected > 100, `expected the real design contract, got ${expected}`);
  assert.deepEqual(result.findings, []);
  assert.match(result.summary, /3 of 3 apps wired/);
});

// ── Registration ─────────────────────────────────────────────────────────────

test('package.json exposes the gate on its own, not behind another linter', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));

  // This used to be `designmd lint DESIGN.md && node scripts/check-design-drift.mjs`,
  // so the token gate sat behind a linter it does not depend on and a red
  // designmd would have stopped it running at all — the `&&` blindness that
  // hid eight gates for six weeks, reproduced inside a single pnpm script.
  assert.equal(manifest.scripts?.['quality:design-drift'], 'node scripts/check-design-drift.mjs');
  assert.equal(manifest.scripts?.['design:lint'], 'designmd lint DESIGN.md');
});

test('CI runs the gate as its own step', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');

  assert.ok(ci.includes('pnpm quality:design-drift'), 'CI lint job must run the gate');
  assert.ok(
    !/&&\s*pnpm quality:design-drift/.test(ci),
    'quality:design-drift must be its own step, never &&-chained behind another gate',
  );
});

test('the API carries the new step in CI_GATES', () => {
  // The API image ships built JS with no .github/ inside it, so the gate-health
  // card cannot derive the expected list from the workflow. A step in neither
  // CI_GATES nor CI_PLUMBING_STEPS reports nothing at all when it vanishes —
  // no row marked skipped, simply no row.
  const gates = readFileSync('apps/api/src/modules/admin/ci-health/gates.ts', 'utf8');

  assert.ok(
    gates.includes("step: 'Check DESIGN.md token drift'"),
    'add the step to CI_GATES in apps/api, or the gate-health card cannot see it',
  );
});

test('importing the gate does not run it', () => {
  assert.equal(process.exitCode, undefined);
});
