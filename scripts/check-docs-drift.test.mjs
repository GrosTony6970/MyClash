/**
 * Tests for check-docs-drift.mjs.
 *
 * Every assertion in the gate gets both directions: a corpus that agrees with
 * the repo must stay silent, and a corpus that disagrees must produce a finding
 * naming the disagreement. A test that only proves the clean case would pass
 * against a gate whose rule body had been deleted.
 *
 * The anti-vacuity guards get the same treatment, because they are the part
 * that fails in the direction of looking healthy: reword a claim and the
 * assertion stops matching, the finding count stays zero, and the gate reports
 * a clean corpus it never actually checked.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ALLOWED_ABSENT,
  checkGateCount,
  checkPaths,
  checkSpecRange,
  checkVersions,
  countLintSteps,
  docCorpus,
  gate,
  isElided,
  parseCount,
  requiredVersions,
} from './check-docs-drift.mjs';

const doc = (path, text) => ({ path, text });

// ── parseCount ───────────────────────────────────────────────────────────────

test('parseCount reads digits, single words and hyphenated tens', () => {
  assert.equal(parseCount('25'), 25);
  assert.equal(parseCount('three'), 3);
  assert.equal(parseCount('twenty'), 20);
  assert.equal(parseCount('twenty-five'), 25);
  assert.equal(parseCount('Twenty-Two'), 22);
  assert.equal(parseCount('thirty one'), 31);
});

test('parseCount refuses what it cannot read rather than guessing', () => {
  assert.equal(parseCount('several'), null);
  assert.equal(parseCount('twenty-twenty'), null);
  assert.equal(parseCount(null), null);
});

// ── requiredVersions ─────────────────────────────────────────────────────────

test('requiredVersions strips the range operator off engines', () => {
  const v = requiredVersions('{"engines":{"node":">=26.0.0","pnpm":">=11.20.0"}}', '26\n');
  assert.deepEqual(v, { node: '26.0.0', pnpm: '11.20.0' });
});

test('requiredVersions falls back to .nvmrc when engines omits node', () => {
  assert.equal(requiredVersions('{"engines":{"pnpm":">=11.20.0"}}', '26\n').node, '26');
});

// ── checkVersions ────────────────────────────────────────────────────────────

const REQUIRED = { node: '26.0.0', pnpm: '11.20.0' };

test('a prerequisite line that matches engines is silent', () => {
  const r = checkVersions([doc('README.md', '# Prereqs: Node 26+, pnpm 11.20+, Docker')], REQUIRED);
  assert.deepEqual(r.findings, []);
  assert.equal(r.compared, 1);
});

test('a stale pnpm prerequisite is caught — the exact bug that recurred twice', () => {
  const r = checkVersions(
    [doc('CONTRIBUTING.md', '# Prerequisites: Node 26+, pnpm 10.27+, Docker Desktop')],
    REQUIRED,
  );
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0].message, /pnpm 10\.27\+.*requires 11\.20\.0/);
});

test('a stale node prerequisite is caught', () => {
  const r = checkVersions([doc('README.md', 'Node 20+, pnpm 11.20+')], REQUIRED);
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0].message, /Node 20\+.*requires 26/);
});

test('a doc may quote a shorter pnpm prefix than engines spells', () => {
  assert.deepEqual(checkVersions([doc('a.md', 'Node 26+, pnpm 11.20+')], REQUIRED).findings, []);
  assert.deepEqual(checkVersions([doc('a.md', 'Node 26+, pnpm 11.20.0+')], REQUIRED).findings, []);
});

// ── countLintSteps ───────────────────────────────────────────────────────────

const FIXTURE_CI = `name: CI
jobs:
  typecheck:
    steps:
      - name: Typecheck all workspaces
        run: pnpm turbo run typecheck

  lint:
    steps:
      - uses: actions/checkout@v4
      - name: Lint all workspaces
        run: pnpm turbo run lint
      - name: Check peer dependencies
        run: pnpm quality:peers
      - name: Build API for OpenAPI emit
        run: pnpm --filter @myclash/api build
      - name: Check bundle budgets
        run: pnpm perf:bundle -- --include-next --require-build

  test:
    steps:
      - name: Test
        run: pnpm turbo run test
`;

test('countLintSteps counts only the lint job, and only after the lint step', () => {
  assert.deepEqual(countLintSteps(FIXTURE_CI), { total: 3, builds: 1, gates: 2 });
});

test('countLintSteps stops at the next job — not at the lint header it opens with', () => {
  // The boundary search must skip index 0, or it matches the `\n  lint:` the
  // slice opens with, returns the whole rest of the workflow, and counts every
  // later job's steps too. That read as 33 against a real 25.
  const withBigTailJob =
    FIXTURE_CI +
    `      - name: Extra one
        run: pnpm one
      - name: Extra two
        run: pnpm two
      - name: Extra three
        run: pnpm three
`;
  assert.equal(
    countLintSteps(withBigTailJob).total,
    3,
    'steps in the test job must not be counted, however many there are',
  );
});

test('a step is a build by its NAME, not by the word build in its command', () => {
  // `pnpm perf:bundle -- --require-build` is the bundle-budget GATE. Grepping
  // the run line for /\bbuild\b/ moved it to the build side and made the split
  // 21/4 against a real 22/3.
  const { builds, gates } = countLintSteps(FIXTURE_CI);
  assert.equal(builds, 1, 'only "Build API for OpenAPI emit" is a build');
  assert.equal(gates, 2, 'peers and bundle budgets are both gates');
});

test('countLintSteps agrees with CI_GATES, which is derived independently', () => {
  const actual = countLintSteps(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const gatesTs = readFileSync('apps/api/src/modules/admin/ci-health/gates.ts', 'utf8');
  const lintRows = (gatesTs.match(/job: 'Lint'/g) ?? []).length;
  // gates.ts counts the `Lint all workspaces` step itself; this gate counts what
  // follows it. Two sources, one number.
  assert.equal(actual.gates, lintRows - 1);
});

// ── checkGateCount ───────────────────────────────────────────────────────────

const ACTUAL = { total: 25, gates: 22, builds: 3 };

test('a matching gate-count sentence is silent, in words or digits', () => {
  assert.deepEqual(
    checkGateCount([doc('CLAUDE.md', 'runs twenty-five further steps, and')], ACTUAL).findings,
    [],
  );
  assert.deepEqual(
    checkGateCount([doc('a.md', 'plus **25 further steps — 22 gates and three builds**')], ACTUAL)
      .findings,
    [],
  );
});

test('a stale gate count is caught — the drift commit 8be03b95 already fixed once', () => {
  const r = checkGateCount([doc('CLAUDE.md', 'runs twenty further steps, and')], ACTUAL);
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0].message, /says twenty further steps.*has 25/);
});

test('a stale gates/builds split is caught on both halves', () => {
  const r = checkGateCount(
    [doc('CONTRIBUTING.md', 'plus nineteen further independent gates and one build')],
    ACTUAL,
  );
  assert.equal(r.findings.length, 2);
  assert.match(r.findings[0].message, /says nineteen gates.*has 22/);
  assert.match(r.findings[1].message, /says one builds.*has 3/);
});

test('a number the parser cannot read is a finding, never a silent pass', () => {
  const r = checkGateCount([doc('a.md', 'runs several further steps')], ACTUAL);
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0].message, /cannot read "several" as a number/);
});

test('the dashed form is not double-counted by the plain total pattern', () => {
  const r = checkGateCount(
    [doc('a.md', '**25 further steps — 22 gates and three builds**')],
    ACTUAL,
  );
  assert.equal(r.compared, 3, 'total, gates, builds — once each');
});

// ── checkSpecRange ───────────────────────────────────────────────────────────

test('a spec range matching the directory is silent', () => {
  const r = checkSpecRange('Specs are numbered `01`…`36` (see the index).', [1, 7, 36]);
  assert.deepEqual(r.findings, []);
  assert.equal(r.compared, 1);
});

test('a spec range that stops short is caught — spec 36 went undocumented for a week', () => {
  const r = checkSpecRange('Specs are numbered `01`…`35`.', [1, 36]);
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0].message, /01…35.*holds 01…36/);
});

// ── checkPaths ───────────────────────────────────────────────────────────────

const resolveOnly = (...ok) => {
  const set = new Set(ok);
  return (p) => set.has(p);
};

test('a path that resolves is silent', () => {
  const r = checkPaths(
    [doc('a.md', 'see `packages/db/migrations/`')],
    resolveOnly('packages/db/migrations/'),
  );
  assert.deepEqual(r.findings, []);
  assert.equal(r.compared, 1);
});

test('a dangling path is caught — fifty of these existed with nothing looking', () => {
  const r = checkPaths(
    [doc('docs/ARCHITECTURE.md', 'full DDL in `packages/db/src/schema/`')],
    () => false,
  );
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0].message, /packages\/db\/src\/schema\/.*does not exist/);
});

test('ALLOWED_ABSENT suppresses a path that is correctly absent', () => {
  const [allowed] = [...ALLOWED_ABSENT.keys()];
  assert.deepEqual(checkPaths([doc('a.md', `see \`${allowed}\``)], () => false).findings, []);
});

test('every ALLOWED_ABSENT entry carries a reason', () => {
  for (const [path, reason] of ALLOWED_ABSENT) {
    assert.ok(typeof reason === 'string' && reason.length > 10, `${path} needs a real reason`);
  }
});

test('an elided or templated path is not treated as a real one', () => {
  assert.ok(isElided('apps/.../pools/color-token.ts'));
  assert.ok(isElided('apps/web-admin/app/org/[slug]/…/schedule'));
  assert.ok(isElided('docs/decisions/ADR-NNN.md'));
  assert.ok(!isElided('apps/api/src/main.ts'));
  assert.deepEqual(checkPaths([doc('a.md', 'see `apps/.../x.ts`')], () => false).findings, []);
});

test('the same path cited twice in one doc is compared once', () => {
  const r = checkPaths(
    [doc('a.md', '`apps/api/src/main.ts` and `apps/api/src/main.ts`')],
    () => true,
  );
  assert.equal(r.compared, 1);
});

// ── Anti-vacuity ─────────────────────────────────────────────────────────────

test('an assertion that matched nothing reports zero comparisons, not silence', () => {
  // Each of these is a corpus the pattern cannot see. The gate turns a zero here
  // into a finding; these prove the zero is reported honestly upstream of that.
  assert.equal(checkVersions([doc('a.md', 'no prerequisite here')], REQUIRED).compared, 0);
  assert.equal(checkGateCount([doc('a.md', 'no counts here')], ACTUAL).compared, 0);
  assert.equal(checkSpecRange('no range here', [1, 2]).compared, 0);
  assert.equal(checkPaths([doc('a.md', 'no paths here')], () => true).compared, 0);
});

test('the gate turns a rotted pattern into a failure', () => {
  const result = gate.run({ argv: [] });
  // The real corpus must match every pattern. If any assertion found nothing,
  // the gate says so by name rather than reporting a clean run.
  const rotted = result.findings.filter((f) => /pattern has rotted/.test(f.message));
  assert.deepEqual(rotted, [], 'every assertion must find its own claims in the real corpus');
});

// ── The real repository ──────────────────────────────────────────────────────

test('the corpus is a real, non-trivial set of documents', () => {
  const files = docCorpus();
  assert.ok(files.length > 20, `expected a real corpus, got ${files.length}`);
  assert.ok(files.includes('README.md'));
  assert.ok(files.includes('CLAUDE.md'));
  assert.ok(!files.some((f) => f.startsWith('docs/superpowers/')), 'the archive is out of scope');
});

test('the gate passes on this repository, over a real number of comparisons', () => {
  const result = gate.run({ argv: [] });
  assert.deepEqual(result.findings, []);
  assert.ok(result.scanned > 100, `expected many comparisons, got ${result.scanned}`);
});

// ── Registration ─────────────────────────────────────────────────────────────

test('package.json exposes the gate on its own, never behind another command', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(manifest.scripts?.['quality:docs-drift'], 'node scripts/check-docs-drift.mjs');
});

test('CI runs the gate as its own step', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.ok(ci.includes('pnpm quality:docs-drift'), 'CI lint job must run the gate');
  assert.ok(
    !/&&\s*pnpm quality:docs-drift/.test(ci),
    'must be its own step, never &&-chained — the shape that hid eight gates for six weeks',
  );
});

test('the API carries the step in CI_GATES', () => {
  // The API image ships built JS with no .github/ inside it, so the gate-health
  // card cannot derive the expected list from the workflow. A step in neither
  // CI_GATES nor CI_PLUMBING_STEPS reports nothing at all when it stops running.
  const gates = readFileSync('apps/api/src/modules/admin/ci-health/gates.ts', 'utf8');
  assert.ok(
    gates.includes("step: 'Check documentation drift'"),
    'add the step to CI_GATES in apps/api, or the gate-health card cannot see it',
  );
});

test('CONTRIBUTING lists the gate in the before-pushing chain', () => {
  // The fourth registration. Nothing else gates it — gates.drift.test.ts only
  // compares ci.yml against CI_GATES — so this test is the only thing holding it.
  const contributing = readFileSync('CONTRIBUTING.md', 'utf8');
  assert.ok(contributing.includes('pnpm quality:docs-drift'));
});

test('importing the gate does not run it', () => {
  assert.equal(process.exitCode, undefined);
});
