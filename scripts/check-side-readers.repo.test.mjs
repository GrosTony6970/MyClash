import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { countSideHits, gate } from './check-side-readers.mjs';

// The real ledger and the gate's registrations. The rule itself is tested on made-up sources in
// check-side-readers.test.mjs.

/**
 * Every `not-yet` line of the ledger. The set may only shrink: a line that a slice resolves leaves
 * this list in the same commit, and a new `not-yet` line is refused even when another one left.
 */
const NOT_YET = [
  'apps/api/src/modules/checkin/checkin.service.ts',
  'apps/api/src/modules/checkin/gear.service.ts',
  'apps/api/src/modules/me/me-events.service.ts',
  'apps/api/src/modules/people-context/people-context.service.ts',
  'apps/api/src/modules/persons/public-schedule.service.ts',
  'apps/api/src/modules/privacy/subject-export.service.ts',
  'apps/api/src/modules/privacy/subject-export.tables.ts',
  'apps/api/src/modules/referees/assignment-board.service.ts',
  'apps/api/src/modules/referees/board-unit-ends.ts',
  'apps/api/src/modules/referees/event-commitments.ts',
  'apps/api/src/modules/registrations/assignments.service.ts',
  'apps/api/src/modules/tournament-query/tournament-query.tools.service.ts',
  'apps/web-admin/app/org/[slug]/events/[eventId]/bracket/page.tsx',
  'apps/web-admin/app/org/[slug]/events/[eventId]/schedule/referee-conflict-rows.ts',
  'apps/web-public/app/e/[eventSlug]/t/[tournamentSlug]/BracketLive.tsx',
];

const realLedger = () => JSON.parse(readFileSync('scripts/side-readers-ledger.json', 'utf8'));

test('the ratchet: the ledger holds exactly the pinned not-yet lines', () => {
  const notYet = Object.entries(realLedger().readers)
    .filter(([, line]) => line.verdict === 'not-yet')
    .map(([path]) => path)
    .sort();
  const added = notYet.filter((path) => !NOT_YET.includes(path));
  const resolved = NOT_YET.filter((path) => !notYet.includes(path));

  assert.deepEqual(
    added,
    [],
    `${added.length} not-yet lines are new (${added.join(', ')}): this number may only go down`,
  );
  assert.deepEqual(
    resolved,
    [],
    `resolved, so take them out of NOT_YET in this test: ${resolved.join(', ')}`,
  );
});

test('the real ledger lists the readers earlier drafts of this gate missed', () => {
  const { readers } = realLedger();

  for (const path of [
    'apps/api/src/modules/schedule/live-state.service.ts',
    'apps/web-staff/src/offline/db.ts',
    'packages/ui/src/utils/protest-chip.ts',
    'apps/web-staff/src/offline/resolve-entry-card.ts',
    'packages/ui/src/utils/bout-flow.ts',
    'packages/ui/src/utils/exchange-timeline.ts',
    'apps/api/src/modules/matches/match-summaries.ts',
    'apps/api/src/modules/phases/match-completion.service.ts',
  ]) {
    const line = readers[path];
    assert.ok(line, `${path} has no ledger line`);
    assert.ok(
      line.byHand === true || countSideHits(readFileSync(path, 'utf8')) > 0,
      `${path} is neither a hit nor listed by hand`,
    );
  }
});

test('the real repo is clean', () => {
  const result = gate.run({ argv: [] });

  assert.deepEqual(result.findings, []);
});

test('scanned is the number of files the filters keep', () => {
  // Built here, apart from the gate, so a filter that drifts in the gate goes red.
  const listed = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--deduplicate'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
    .split('\0')
    .filter(Boolean);
  const kept = listed.filter(
    (path) =>
      /^(apps|packages|scripts)\//.test(path) &&
      /\.(ts|tsx|mjs|sql)$/.test(path) &&
      !/\.(test|spec|fixtures)\./.test(path) &&
      !/\.harness\.ts$/.test(path) &&
      !path.includes('test-helpers') &&
      !path.includes('/testing/') &&
      !path.startsWith('packages/db/fixtures/') &&
      !path.startsWith('packages/api-client/src/generated/') &&
      path !== 'scripts/check-side-readers.mjs' &&
      existsSync(path),
  );

  const { scanned } = gate.run({ argv: [] });

  assert.equal(scanned, kept.length);
  assert.ok(kept.length > 100, `expected the real source tree, got ${kept.length}`);
});

// ── Registration ─────────────────────────────────────────────────────────────

test('package.json exposes the gate on its own', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));

  assert.equal(manifest.scripts?.['quality:side-readers'], 'node scripts/check-side-readers.mjs');
});

/**
 * The trimmed lines of the CI step named `name`: its `- name:` line, then every line indented
 * deeper than it, up to the next step. Read line by line, so no regex can backtrack on the YAML.
 */
const ciStep = (ci, name) => {
  const lines = ci.split('\n').map((line) => line.replace(/\r$/, ''));
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  if (start === -1) return [];
  const indent = lines[start].search(/\S/);
  const step = [lines[start].trim()];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') continue;
    if (line.search(/\S/) <= indent) break;
    step.push(line.trim());
  }
  return step;
};

test('CI runs the gate as its own step, which a red gate before it does not stop', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  const step = ciStep(ci, 'Check Match side readers');

  assert.ok(
    step.includes('run: pnpm quality:side-readers'),
    'CI lint job must run the gate in the step "Check Match side readers"',
  );
  assert.ok(step.includes("if: '!cancelled()'"), "the step needs if: '!cancelled()'");
  assert.ok(
    !/&&\s*pnpm quality:side-readers/.test(ci),
    'quality:side-readers must be its own step, never &&-chained behind another gate',
  );
});

test('the API carries the new step in CI_GATES', () => {
  const gates = readFileSync('apps/api/src/modules/admin/ci-health/gates.ts', 'utf8');

  assert.ok(
    gates.includes("step: 'Check Match side readers'"),
    'add the step to CI_GATES in apps/api, or the gate-health card cannot see it',
  );
});

test('CONTRIBUTING lists the gate in the before-pushing chain', () => {
  // gates.drift.test.ts compares ci.yml with CI_GATES only; nothing else reads CONTRIBUTING.
  assert.ok(readFileSync('CONTRIBUTING.md', 'utf8').includes('pnpm quality:side-readers'));
});

test('importing the gate does not run it', () => {
  assert.equal(process.exitCode, undefined);
});
