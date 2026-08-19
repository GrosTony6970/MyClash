/**
 * check-css-vars.mjs — every `var(--x)` resolves, and no read hides behind a fallback.
 *
 * ── Why this gate exists ────────────────────────────────────────────────────
 * `var(--x, fallback)` has exactly two outcomes, and this repo has shipped both
 * as bugs:
 *
 *   1. Nothing produces `--x`. Then the fallback is not a safety net — it is the
 *      only value that ever renders. `var(--event-primary, #c0392b)` was the
 *      real accent on every `/e/*` page for months (D2), and `var(--event-accent,
 *      #f59e0b)` repeated it one variable name over, shipping raw gold at 2.06:1
 *      on nine `text-xs` headings until 2026-08-19 (D11).
 *   2. Something does produce `--x`. Then the fallback never fires, and nothing
 *      keeps its value honest. `Card.tsx` carried `#111827` for a `#ffffff`
 *      surface (D5); `EmptyState.tsx` carried `#ffffff` for the `#0f172a` ink
 *      token, plus two different fallbacks for one token five lines apart.
 *
 * So the rule is not "prefer tokens". It is CLAUDE.md's branch rule applied to
 * CSS: a branch that cannot fire, or that is the only branch that ever fires
 * while claiming to be the spare, is the bug. Both readings of a fallback are
 * wrong, so the gate rejects the shape rather than trying to judge the value.
 *
 * ── Why nothing caught these ────────────────────────────────────────────────
 * `check-design-drift.mjs` compares DESIGN.md against theme.css and never opens
 * a component file. `eslint-rules/no-raw-palette-color.mjs` matches only
 * `prefix-hue-number` class tokens, so moving `text-gray-600` into
 * `text-[var(--color-muted,#4b5563)]` silenced it — the 2026-06-27 conversion
 * turned three visible violations into three invisible ones. There is no
 * stylelint. This gate is the missing half: it reads the source, not the docs.
 *
 * ── Why `scanned` counts READS and not files ────────────────────────────────
 * A file count here would be ~2140 and would stay ~2140 if the `var(` matcher
 * broke, reporting a clean scan over nothing found. What can silently collapse
 * is the number of var() references actually resolved, so that is the count.
 *
 * ── No exemption marker, on purpose ─────────────────────────────────────────
 * There are zero fallbacks in the repo and every one of the 29 variables read
 * resolves to a producer, so an escape hatch would ship ahead of its first real
 * consumer. If a genuine case appears — a property set by something outside
 * `apps/` and `packages/` — the fix is usually to produce the variable, and the
 * exemption is a decision to take then, the way `nothingToCount` waited for
 * check-edge-plugins.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { defineGate } from './lib/gate.mjs';
import { walkRepoFiles, toRepoPath } from './lib/repo-scan.mjs';

const ROOTS = ['apps', 'packages'];
const SOURCE = /\.(tsx?|css)$/;

/**
 * Blank out comments, preserving every newline.
 *
 * The line number is half of each finding, so a stripper that COLLAPSES a block
 * comment silently shifts every line after it — the first draft of this gate
 * reported a real defect at :315 that lives at :329. Block comments become the
 * same number of newlines they occupied; line comments are dropped only when
 * the line has no `://`, so a URL in a template literal survives.
 *
 * Comments must go at all because they discuss this syntax: theme.css explains
 * that `.shadow-sm` "never reads var(--shadow-sm)", and a scanner that reads
 * prose finds a variable nobody produces.
 */
export function blankComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => (line.includes('://') ? line : line.replace(/\/\/.*$/, '')))
    .join('\n');
}

const READ = /var\(\s*(--[\w-]+)\s*(?:,([^)]*))?\)/g;

/**
 * The four ways this repo declares a custom property.
 *
 * A CSS declaration and a JS object key look alike but are not — `'--panel-w':`
 * carries quotes the CSS form never has, and the first draft's `(--[\w-]+)\s*:`
 * matched only the bare form, so a property set from a `style` prop read as
 * unproduced. `variable:` is next/font, which registers the property on the html
 * element without ever spelling it in CSS; `checkAppWiring` in
 * check-design-drift.mjs asserts the same three font properties for that reason.
 */
const PRODUCERS = [
  /(?:^|[{;,'"\s])(--[\w-]+)['"]?\s*:/g,
  /setProperty\(\s*['"`](--[\w-]+)['"`]/g,
  /variable\s*:\s*['"`](--[\w-]+)['"`]/g,
];

/** Every property one line declares. Exported so the test drives these patterns
 *  rather than a second copy of them. */
export function producersIn(text) {
  const names = [];
  for (const pattern of PRODUCERS) {
    for (const match of text.matchAll(pattern)) names.push(match[1]);
  }
  return names;
}

/** Read every source file under `roots` and index reads against producers. */
export function collect(root = process.cwd(), roots = ROOTS) {
  const reads = [];
  const producers = new Map();
  let files = 0;

  for (const dir of roots) {
    for (const absolute of walkRepoFiles(join(root, dir))) {
      if (!SOURCE.test(absolute)) continue;
      files++;
      const path = toRepoPath(absolute, root);
      const source = blankComments(readFileSync(absolute, 'utf8'));

      source.split('\n').forEach((text, index) => {
        const line = index + 1;
        for (const match of text.matchAll(READ)) {
          reads.push({ path, line, name: match[1], fallback: (match[2] ?? '').trim() });
        }
        for (const name of producersIn(text)) {
          if (!producers.has(name)) producers.set(name, `${path}:${line}`);
        }
      });
    }
  }
  return { reads, producers, files };
}

/**
 * One finding per bad read.
 *
 * An unproduced read that also carries a fallback is reported once, under the
 * unproduced rule: that is the more serious of the two readings, because the
 * fallback is live output rather than dead code.
 */
export function judge({ reads, producers }) {
  const findings = [];
  for (const { path, line, name, fallback } of reads) {
    const producedAt = producers.get(name);
    if (!producedAt) {
      findings.push({
        message:
          `${path}:${line} reads var(${name}), which nothing under ${ROOTS.join('/ or ')}/ produces` +
          (fallback
            ? ` — so the fallback "${fallback}" is not a spare, it is the only value this ever renders.`
            : ' — so this declaration resolves to nothing.'),
      });
      continue;
    }
    if (fallback) {
      findings.push({
        message:
          `${path}:${line} reads var(${name}, ${fallback}), but ${name} is produced at ` +
          `${producedAt}, so the fallback can never fire and nothing keeps its value honest.`,
      });
    }
  }
  return findings;
}

export const gate = defineGate({
  name: 'CSS custom properties',
  entry: import.meta.url,
  run: () => {
    const { reads, producers, files } = collect();
    const names = new Set(reads.map((read) => read.name));

    return {
      findings: judge({ reads, producers }),
      scanned: reads.length,
      summary:
        `CSS custom properties OK: ${reads.length} var() read(s) across ${names.size} ` +
        `distinct propert(ies) all resolve to a producer, and none carries a fallback, ` +
        `over ${files} source file(s).`,
      remedy:
        'A fallback in var(--x, y) is wrong whichever way it resolves. If --x has no producer,\n' +
        'y is the shipped value wearing a safety net (D2, D11). If --x has one, y is dead code\n' +
        'that drifts from the token it claims to mirror (D5). Produce the property, or read it\n' +
        'bare — and if a component wants a token, prefer the utility (text-muted) over\n' +
        'text-[var(--color-muted)], which the palette lint cannot see into.',
    };
  },
});
