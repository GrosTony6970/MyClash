#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'docs/PERFORMANCE_REVIEW.md',
  'scripts/check-performance-review.mjs',
  'scripts/check-bundle-budgets.mjs',
  'scripts/perf-load-smoke.mjs',
  'tests/perf/web-public.spec.ts',
  'packages/db/fixtures/phase4_explain.sql',
  'packages/db/fixtures/phase4_synthetic.sql',
];

const requiredDocPhrases = [
  'Status: Pass with known issues',
  'SQL Query Review',
  'Supabase Postgres best-practices',
  'N+1',
  'Connection Pool',
  'Bundle Budgets',
  'Web Vitals',
  'Load Test',
  'Caching',
  'Owner Evidence Checklist',
];

const requiredSqlStatuses = ['pass', 'needs index', 'needs rewrite', 'accepted v1 risk'];

const failures = [];

for (const file of requiredFiles) {
  if (!existsSync(file)) failures.push(`Missing required Phase 7 artifact: ${file}`);
}

if (existsSync('docs/PERFORMANCE_REVIEW.md')) {
  const review = readFileSync('docs/PERFORMANCE_REVIEW.md', 'utf8');
  for (const phrase of requiredDocPhrases) {
    if (!review.includes(phrase)) {
      failures.push(`docs/PERFORMANCE_REVIEW.md must include "${phrase}"`);
    }
  }
  for (const status of requiredSqlStatuses) {
    if (!review.includes(status)) {
      failures.push(`SQL review must document "${status}" classification`);
    }
  }
}

const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));
const expectedScripts = {
  'perf:review': 'node scripts/check-performance-review.mjs',
  'perf:bundle': 'node scripts/check-bundle-budgets.mjs',
  'perf:load': 'node scripts/perf-load-smoke.mjs',
  'db:perf:fixture': 'node scripts/db-synthetic-fixture.mjs --check',
  'db:perf:explain': 'node scripts/db-explain-report.mjs',
};

for (const [name, command] of Object.entries(expectedScripts)) {
  if (rootPackage.scripts?.[name] !== command) {
    failures.push(`package.json must expose "${name}": "${command}"`);
  }
}

// Registration is not execution. The expectedScripts loop above proves each
// gate has a package.json entry, and for perf:bundle that was the only thing
// anything proved: it sat registered and unrun for weeks, reading a Next
// manifest that had been deleted from the framework, and no gate noticed
// because none of them asked whether a workflow invokes it. Assert the run.
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
// perf:bundle is asserted below rather than here: a bare `includes` for it also
// matches `pnpm perf:bundle:build`, so dropping the check step while keeping the
// build step would have passed this loop.
if (!ci.includes('pnpm perf:review')) {
  failures.push('CI lint job must run pnpm perf:review');
}

// A bundle budget with nothing built is a budget over an empty directory, and
// that passes. The step must demand the build it measures, and must ask for the
// page-load budgets by name: without --include-next all three skip themselves
// and the step passes having weighed only the marketing site, which is how this
// gate spent its whole life — registered, invoked, and measuring nothing.
const bundleStep = /pnpm perf:bundle(?! ?:)((?: -[-\w]+)*)/.exec(ci);
if (!bundleStep) {
  failures.push('CI lint job must run pnpm perf:bundle');
} else {
  for (const flag of ['--require-build', '--include-next']) {
    if (!bundleStep[1].includes(flag)) {
      failures.push(
        `CI must run pnpm perf:bundle with ${flag}. Without it the budgets skip themselves and the step still passes.`,
      );
    }
  }
}

// The builds those budgets weigh. A page-load budget with no build skips under
// warn, or fails under --require-build; either way the step is not measuring.
if (!ci.includes('pnpm perf:bundle:build')) {
  failures.push('CI lint job must run pnpm perf:bundle:build before checking the bundle budgets.');
}

const perfSpec = readFileSync('tests/perf/web-public.spec.ts', 'utf8');
for (const phrase of ['LCP_BUDGET_MS', 'CLS_BUDGET', 'web-admin', 'web-staff']) {
  if (!perfSpec.includes(phrase)) {
    failures.push(`Playwright perf spec must include ${phrase}`);
  }
}

const explainWorkload = readFileSync('packages/db/fixtures/phase4_explain.sql', 'utf8');
for (const phrase of ['public event', 'my schedule', 'live lice', 'audit log']) {
  if (!explainWorkload.toLowerCase().includes(phrase)) {
    failures.push(`Phase 4 EXPLAIN workload must cover ${phrase}`);
  }
}

if (failures.length > 0) {
  console.error(
    ['Performance review failed:', ...failures.map((failure) => `- ${failure}`)].join('\n'),
  );
  process.exitCode = 1;
} else {
  console.log('Performance review checks passed.');
}
