/**
 * check-design-drift.mjs — keeps DESIGN.md honest.
 *
 * DESIGN.md restates token values that actually live in packages/ui/src/theme.css.
 * Restated values rot: this repo already shipped a "canonical source of truth"
 * (packages/design-tokens) naming fonts that nothing renders. This gate makes
 * that failure impossible to repeat.
 *
 * Three assertions:
 *   1. colors — every `colors.*` in DESIGN.md matches its --color-* in theme.css,
 *      across all three scopes (base, [data-theme='dark'], [data-accent='personal']).
 *   2. fonts  — the font stacks in DESIGN.md match --font-* in theme.css.
 *   3. wiring — every app that imports theme.css DEFINES each --font-* var that
 *      theme.css references. Without this, an app renders valid CSS with correct
 *      colours in Georgia — which is exactly what web-staff did until 2026-07-17.
 *
 * Scope: only what theme.css actually defines is asserted. Aspirational rules in
 * DESIGN.md (e.g. "#b91c1c is the one red") are NOT gated here — they live in
 * docs/design/known-deviations.md, because a gate for them would fail instantly
 * on the DB default and the transactional emails. Gate what is true; document
 * what is intended.
 *
 * ── Why `scanned` counts comparisons and not files ──────────────────────────
 * This gate reads two files, so a file count would be the constant 2 and would
 * prove nothing. What can silently shrink is the number of things COMPARED, and
 * two of those counts used to be hardcoded: the summary line said
 * `${APPS.length} apps wired`, which printed "3 apps wired" even when all three
 * had been skipped by the guards in checkAppWiring, and FONT_KEYS was a literal
 * three-element list, so a fourth stack added to theme.css would never have been
 * compared. Both are derived now, and their sum is what the harness checks.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { defineGate } from './lib/gate.mjs';

const root = process.cwd();
const THEME = 'packages/ui/src/theme.css';
const DESIGN = 'DESIGN.md';
export const APPS = ['apps/web-admin', 'apps/web-public', 'apps/web-staff'];

const read = (p) => readFileSync(join(root, p), 'utf8');

/** Extract `--name: value;` pairs from a slice of CSS. */
function parseVars(css) {
  const out = new Map();
  for (const [, name, value] of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(name, value.trim());
  }
  return out;
}

/** Slice a top-level block by its selector, brace-matched. */
function block(css, selector) {
  const start = css.indexOf(selector);
  if (start === -1) return '';
  const open = css.indexOf('{', start);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  return '';
}

/**
 * The three scopes and the font vars theme.css defers to next/font.
 *
 * Comments are stripped FIRST. theme.css documents its own scopes in the header
 * comment ("[data-theme='dark'] → dark SURFACE tokens"), so a naive indexOf on
 * the raw source matches the prose and then brace-matches the @theme block that
 * follows it — silently parsing the base scope three times.
 */
export function parseTheme(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return {
    base: parseVars(block(stripped, '@theme')),
    dark: parseVars(block(stripped, "[data-theme='dark']")),
    personal: parseVars(block(stripped, "[data-accent='personal']")),
    referenced: [
      ...new Set([...stripped.matchAll(/var\(\s*(--font-[\w-]+)\s*\)/g)].map((m) => m[1])),
    ],
  };
}

export function checkThemeParsed({ base, dark, personal }) {
  const findings = [];
  if (base.size === 0) findings.push(`${THEME}: could not parse the @theme block.`);
  if (dark.size === 0) findings.push(`${THEME}: could not parse the [data-theme='dark'] block.`);
  if (personal.size === 0) {
    findings.push(`${THEME}: could not parse the [data-accent='personal'] block.`);
  }
  return findings;
}

/**
 * Minimal reader for the flat `colors:` map. We deliberately do not add a YAML
 * dependency: the shape we need is one level deep and fully predictable.
 */
function readColors(frontMatter) {
  const out = new Map();
  const lines = frontMatter.split(/\r?\n/);
  const start = lines.findIndex((l) => /^colors:\s*$/.test(l));
  if (start === -1) return out;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line) && line.trim() !== '') break; // next top-level key
    const m = line.match(/^\s{2}([\w-]+):\s*'([^']+)'/);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

/**
 * The `typography:` map, key -> the fontFamily string that key declares.
 *
 * Same hand-rolled reader as readColors, one nesting level deeper. The font
 * check below needs the entry that BELONGS to the key: it used to search the
 * whole document, which passes on an occurrence anywhere. DESIGN.md reuses the
 * display stack in h1 and h2, so deleting the display entry outright left this
 * gate green — the check could not fail for the one edit it exists to catch.
 */
function readTypography(frontMatter) {
  const out = new Map();
  const lines = frontMatter.split(/\r?\n/);
  const start = lines.findIndex((l) => /^typography:\s*$/.test(l));
  if (start === -1) return out;
  let key = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line) && line.trim() !== '') break; // next top-level key
    const entry = line.match(/^\s{2}([\w-]+):\s*$/);
    if (entry) {
      key = entry[1];
      continue;
    }
    const family = line.match(/^\s{4}fontFamily:\s*"([^"]+)"/);
    if (family && key) out.set(key, family[1]);
  }
  return out;
}

/** `colors` and `fonts` from the front matter; `frontMatter: null` if there is none. */
export function parseDesignMd(markdown) {
  const fm = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return { frontMatter: null, colors: new Map(), fonts: new Map() };
  return { frontMatter: fm[1], colors: readColors(fm[1]), fonts: readTypography(fm[1]) };
}

export function checkDesignParsed({ frontMatter, colors, fonts }) {
  if (frontMatter === null) return [`${DESIGN}: no YAML front matter found.`];
  const findings = [];
  if (colors.size === 0) findings.push(`${DESIGN}: could not parse the colors map.`);
  if (fonts.size === 0) findings.push(`${DESIGN}: could not parse the typography map.`);
  return findings;
}

/** Map a DESIGN.md key to the scope + CSS var it mirrors. */
function resolve(key, { base, dark, personal }) {
  if (key.startsWith('dark-')) return { scope: dark, css: `--color-${key.slice(5)}`, in: 'dark' };
  if (key === 'accent-personal') return { scope: personal, css: '--color-accent', in: 'personal' };
  if (key === 'accent-personal-hover') {
    return { scope: personal, css: '--color-accent-hover', in: 'personal' };
  }
  return { scope: base, css: `--color-${key}`, in: 'base' };
}

/**
 * Both directions: what DESIGN.md claims, and what theme.css defines but
 * DESIGN.md never documents. `compared` counts the assertions actually made —
 * an alias ref mirrors nothing and is not one of them.
 */
export function checkColors(designColors, scopes) {
  const findings = [];
  let compared = 0;

  for (const [key, value] of designColors) {
    if (value.startsWith('{')) continue; // alias ref (primary → accent); nothing to mirror
    const { scope, css, in: scopeName } = resolve(key, scopes);
    compared += 1;
    if (!scope.has(css)) {
      findings.push(
        `${DESIGN} colors.${key}: no ${css} in the ${scopeName} scope of ${THEME}. ` +
          `Either the token was renamed/removed, or DESIGN.md invented it.`,
      );
      continue;
    }
    const actual = scope.get(css);
    if (actual.toLowerCase() !== value.toLowerCase()) {
      findings.push(
        `${DESIGN} colors.${key}: says ${value}, but ${THEME} ${scopeName} has ${css}: ${actual}.`,
      );
    }
  }

  for (const [name] of scopes.base) {
    if (!name.startsWith('--color-')) continue;
    compared += 1;
    const key = name.slice('--color-'.length);
    if (!designColors.has(key)) {
      findings.push(`${THEME} defines ${name} but ${DESIGN} does not document colors.${key}.`);
    }
  }

  return { findings, compared };
}

/**
 * The font stacks theme.css defines, checked against DESIGN.md.
 *
 * theme.css: --font-display: var(--font-fraunces), 'Iowan Old Style', ...
 * DESIGN.md: fontFamily: "Fraunces, 'Iowan Old Style', ..."
 * Compare the identifiable family names rather than the raw strings, since the
 * CSS carries a var() indirection the markdown cannot.
 *
 * The keys are DERIVED from the base scope rather than listed. As a literal
 * ['display', 'body', 'mono'] this loop could not see a fourth stack, and the
 * count it contributed to the summary was a constant either way.
 */
export function fontKeysOf(base) {
  return [...base.keys()]
    .filter((name) => name.startsWith('--font-'))
    .map((name) => name.slice('--font-'.length));
}

export function checkFonts(base, designFonts) {
  const findings = [];
  const keys = fontKeysOf(base);

  for (const key of keys) {
    const css = base.get(`--font-${key}`);
    // The primary family is the var(--font-x) indirection; the rest are fallbacks.
    const indirection = css.match(/var\(\s*(--font-[\w-]+)\s*\)/);
    if (!indirection) {
      findings.push(
        `${THEME} --font-${key}: expected a var(--font-*) indirection so next/font can supply it.`,
      );
      continue;
    }
    const fallbacks = css
      .slice(css.indexOf(')') + 1)
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    // Three named outcomes where there used to be one silent one. The old rule
    // was `fallbacks.length && !designMd.includes(fallbacks[0])`, which reported
    // nothing at all when a stack declared no fallbacks, and matched the fallback
    // anywhere in the document when it did.
    const documented = designFonts.get(key);
    if (documented === undefined) {
      findings.push(
        `${DESIGN}: typography.${key} declares no fontFamily to compare with ${THEME}.`,
      );
    } else if (!fallbacks.length) {
      findings.push(
        `${THEME} --font-${key}: names no fallback families after the var() indirection, so a page ` +
          `renders in the browser default until next/font arrives.`,
      );
    } else if (!documented.includes(fallbacks[0])) {
      findings.push(
        `${DESIGN} typography.${key}: does not mention the "${fallbacks[0]}" fallback from ${THEME}.`,
      );
    }
  }

  return { findings, compared: keys.length };
}

/**
 * An app's layout sources, or null when the app does not use the theme at all.
 *
 * Separate from the rule so the rule can be tested without a filesystem, and so
 * "this app was skipped" is a value rather than a `continue` nobody can count.
 */
export function readAppWiring(app) {
  const globals = join(app, 'src/styles/globals.css');
  if (!existsSync(join(root, globals))) return null;
  if (!read(globals).includes('packages/ui/src/theme.css')) return null;
  return ['app/layout.tsx', 'src/app/layout.tsx']
    .map((p) => join(root, app, p))
    .filter((p) => existsSync(p))
    .map((p) => readFileSync(p, 'utf8'))
    .join('\n');
}

/** The check that catches the web-staff class of bug: correct colours, wrong font. */
export function checkAppWiring(apps, referenced, load = readAppWiring) {
  const findings = [];
  let wired = 0;
  let compared = 0;

  for (const app of apps) {
    const source = load(app);
    if (source === null) continue; // does not use the theme
    wired += 1;
    for (const v of referenced) {
      compared += 1;
      if (!source.includes(`'${v}'`) && !source.includes(`"${v}"`)) {
        findings.push(
          `${app}: imports ${THEME} (which references var(${v})) but never defines ${v}. ` +
            `The app will render valid CSS with correct colours in a fallback font. ` +
            `Add it via next/font in ${app}/app/layout.tsx.`,
        );
      }
    }
  }

  return { findings, wired, compared };
}

export const gate = defineGate({
  name: 'Design system drift',
  entry: import.meta.url,
  run: () => {
    const theme = parseTheme(read(THEME));
    const design = parseDesignMd(read(DESIGN));
    const remedy =
      `${DESIGN} restates values owned by ${THEME}. Fix whichever is wrong — ` +
      `theme.css is the source of truth for values.`;

    // Nothing below can say anything useful about a document that would not
    // parse, and reporting 38 undocumented tokens because the front matter is
    // missing buries the one finding that matters.
    const unparsed = [...checkThemeParsed(theme), ...checkDesignParsed(design)];
    if (unparsed.length) return { findings: unparsed, scanned: 0, summary: 'unreachable', remedy };

    const colors = checkColors(design.colors, theme);
    const fonts = checkFonts(theme.base, design.fonts);
    const wiring = checkAppWiring(APPS, theme.referenced);
    const scanned = colors.compared + fonts.compared + wiring.compared;

    return {
      findings: [...colors.findings, ...fonts.findings, ...wiring.findings],
      scanned,
      summary:
        `DESIGN.md matches ${THEME}: ${colors.compared} colour assertions, ` +
        `${fonts.compared} font stacks, ${wiring.wired} of ${APPS.length} apps wired ` +
        `(${scanned} comparisons).`,
      remedy,
    };
  },
});
