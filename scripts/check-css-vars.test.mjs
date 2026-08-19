/**
 * Tests for check-css-vars.mjs.
 *
 * The gate's whole value is that it can go red on two shapes that shipped for
 * months, so the tests assert the FINDING TEXT rather than a count or an exit
 * code: a gate whose test checks only `findings.length` passes just as happily
 * when the message names the wrong variable, and the variable name is the part
 * a reader acts on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { blankComments, producersIn, judge, gate } from './check-css-vars.mjs';

// ── The two rules ────────────────────────────────────────────────────────────

test('an unproduced read is reported as the shipped value, not a spare', () => {
  const findings = judge({
    reads: [{ path: 'a.tsx', line: 7, name: '--event-accent', fallback: '#f59e0b' }],
    producers: new Map(),
  });

  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /--event-accent/);
  assert.match(findings[0].message, /a\.tsx:7/);
  assert.match(findings[0].message, /#f59e0b/);
  assert.match(findings[0].message, /only value this ever renders/);
});

test('an unproduced read with no fallback is still reported', () => {
  const findings = judge({
    reads: [{ path: 'a.css', line: 3, name: '--typo', fallback: '' }],
    producers: new Map(),
  });

  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /--typo/);
  assert.match(findings[0].message, /resolves to nothing/);
});

test('a produced read with a fallback is reported as dead, and cites the producer', () => {
  const findings = judge({
    reads: [{ path: 'EmptyState.tsx', line: 24, name: '--color-foreground', fallback: '#ffffff' }],
    producers: new Map([['--color-foreground', 'packages/ui/src/theme.css:27']]),
  });

  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /--color-foreground/);
  assert.match(findings[0].message, /#ffffff/);
  assert.match(findings[0].message, /theme\.css:27/);
  assert.match(findings[0].message, /can never fire/);
});

test('a produced read with no fallback is clean', () => {
  const findings = judge({
    reads: [{ path: 'a.tsx', line: 1, name: '--color-muted', fallback: '' }],
    producers: new Map([['--color-muted', 'theme.css:29']]),
  });

  assert.deepEqual(findings, []);
});

test('an unproduced read with a fallback is reported ONCE, under the graver rule', () => {
  // Both rules match this shape. Reporting it twice would double-count the
  // repo's most common defect and make the finding count meaningless.
  const findings = judge({
    reads: [{ path: 'a.tsx', line: 1, name: '--gone', fallback: '#abc123' }],
    producers: new Map(),
  });

  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /only value this ever renders/);
});

// ── Comment handling ─────────────────────────────────────────────────────────

test('blankComments preserves the line count, so findings cite the real line', () => {
  // The first draft collapsed block comments and reported a defect 14 lines
  // above where it lives. Line numbers are half of every finding here.
  const source = ['/**', ' * a', ' * b', ' */', 'x'].join('\n');

  assert.equal(blankComments(source).split('\n').length, source.split('\n').length);
  assert.match(blankComments(source).split('\n')[4], /x/);
});

test('prose about var() is not a read — theme.css discusses var(--shadow-sm)', () => {
  const source = '/* .shadow-sm never reads var(--shadow-sm) anyway */\n';

  assert.equal([...blankComments(source).matchAll(/var\(/g)].length, 0);
});

test('a URL in a line survives line-comment stripping', () => {
  const source = "const u = 'https://example.test/x'; color: var(--kept);";

  assert.match(blankComments(source), /var\(--kept\)/);
  assert.match(blankComments(source), /https:\/\/example\.test/);
});

// ── Producer forms ───────────────────────────────────────────────────────────

test('every producer form this repo uses is recognised', () => {
  // Each of these was a real false positive in an earlier draft: the bare CSS
  // form was the only one matched, so a property set from a `style` prop or by
  // next/font read as unproduced.
  const cases = [
    ['  --color-muted: #64748b;', '--color-muted'],
    ["  style={{ '--panel-w': `${w}px` }}", '--panel-w'],
    ["  el.style.setProperty('--panel-h', '4px');", '--panel-h'],
    ["  variable: '--font-fraunces',", '--font-fraunces'],
  ];

  for (const [line, name] of cases) {
    assert.ok(producersIn(line).includes(name), `${name} should be recognised as produced`);
  }
});

test('a var() READ is not mistaken for a declaration', () => {
  // If it were, every unproduced read would produce itself and the first rule
  // could never fire — the gate would be green by construction.
  assert.deepEqual(producersIn('  color: var(--color-muted);'), []);
});

// ── The real repo ────────────────────────────────────────────────────────────

test('the repo is clean, and the scan actually found something to check', () => {
  const result = gate.run({ argv: [] });

  assert.deepEqual(
    result.findings.map((f) => f.message),
    [],
  );
  // Anti-vacuity: `scanned` counts var() READS, so a broken matcher collapses it
  // even though the file count would stay put. A repo-wide floor makes a
  // silently-collapsed rule fail here rather than report a clean scan.
  assert.equal(result.scanned > 100, true, `expected real var() reads, got ${result.scanned}`);
  assert.match(result.summary, /all resolve to a producer/);
});

test('scanned counts reads, not files', () => {
  const result = gate.run({ argv: [] });
  const files = Number(result.summary.match(/over (\d+) source file/)[1]);

  assert.notEqual(result.scanned, files);
});

// ── Registration ─────────────────────────────────────────────────────────────

test('package.json exposes the gate on its own, never behind another command', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));

  assert.equal(manifest.scripts?.['quality:css-vars'], 'node scripts/check-css-vars.mjs');
});

test('CI runs the gate as its own step, with if: !cancelled()', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');

  assert.ok(ci.includes('pnpm quality:css-vars'), 'CI lint job must run the gate');
  assert.ok(
    !/&&\s*pnpm quality:css-vars/.test(ci),
    'quality:css-vars must be its own step, never &&-chained behind another gate',
  );
  assert.match(ci, /- name: Check CSS custom properties\n\s+if: '!cancelled\(\)'/);
});

test('the API carries the new step in CI_GATES', () => {
  const gates = readFileSync('apps/api/src/modules/admin/ci-health/gates.ts', 'utf8');

  assert.ok(
    gates.includes("step: 'Check CSS custom properties'"),
    'add the step to CI_GATES in apps/api, or the gate-health card cannot see it',
  );
});

test('CONTRIBUTING lists the gate, since no test but this one reads that file', () => {
  const contributing = readFileSync('CONTRIBUTING.md', 'utf8');

  assert.match(contributing, /pnpm quality:css-vars/);
});

test('importing the gate does not run it', () => {
  assert.equal(process.exitCode, undefined);
});
