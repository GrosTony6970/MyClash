import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ALLOWLIST_DOC,
  FORBIDDEN_ON_THE_PAD,
  PAD_REACHABLE,
  PURE_PACKAGE,
  RE_EXPORTER,
  findDeclaredDependencies,
  findEngineOnThePad,
  findOutwardImports,
  findUnallowedPadArithmetic,
  gate,
  padImportSurface,
  parseAllowlist,
  scanRepo,
  specifiersIn,
  valueBindingsFromRules,
} from './check-package-purity.mjs';

/**
 * Every rule below is proved to FIRE on a seeded breach before it is trusted to
 * report a clean repo. A gate whose test only asserts the exit code passes green
 * while checking nothing, which is the exact defect this fleet keeps producing.
 */

// ── specifiersIn ─────────────────────────────────────────────────────────────

test('specifiersIn finds every shape a module specifier arrives in', () => {
  const source = [
    "import { a } from './local';",
    "import type { B } from '@myclash/types';",
    "export { c } from '../sibling';",
    "export type { D } from 'zod';",
    "import 'side-effect-only';",
    "const e = require('legacy');",
  ].join('\n');

  assert.deepEqual(specifiersIn(source).sort(), [
    '../sibling',
    './local',
    '@myclash/types',
    'legacy',
    'side-effect-only',
    'zod',
  ]);
});

test('specifiersIn does not mistake a string that merely says import', () => {
  assert.deepEqual(specifiersIn('const message = "you cannot import from here";'), []);
});

// ── Rule 1: no runtime dependencies ──────────────────────────────────────────

test('rule 1 fires on a declared runtime dependency', () => {
  const findings = findDeclaredDependencies({ dependencies: { zod: '^4.4.3' } });

  assert.equal(findings.length, 1);
  assert.match(findings[0], /zod/);
  assert.match(findings[0], /must have none/);
});

test('rule 1 ignores devDependencies — typescript and vitest never ship', () => {
  assert.deepEqual(
    findDeclaredDependencies({ devDependencies: { typescript: '^6.0.3', vitest: '^4.1.10' } }),
    [],
  );
});

test('rule 1 accepts both an empty dependencies object and none at all', () => {
  assert.deepEqual(findDeclaredDependencies({ dependencies: {} }), []);
  assert.deepEqual(findDeclaredDependencies({}), []);
});

// ── Rule 2: nothing reaches outside the package ──────────────────────────────

test('rule 2 fires on a bare specifier in the emit program', () => {
  const read = () => "import { z } from 'zod';";
  const findings = findOutwardImports(['/repo/packages/rules/src/x.ts'], read, (f) => f);

  assert.equal(findings.length, 1);
  assert.match(findings[0], /imports "zod"/);
});

test('rule 2 allows relative specifiers, which stay inside by construction', () => {
  const read = () => "import { a } from './afterblow';\nimport { b } from '../shared';";

  assert.deepEqual(
    findOutwardImports(['/repo/packages/rules/src/x.ts'], read, (f) => f),
    [],
  );
});

test('rule 2 would fire on vitest — which is why it reads the emit program, not src/', () => {
  const read = () => "import { describe } from 'vitest';";
  const findings = findOutwardImports(['/repo/packages/rules/src/x.test.ts'], read, (f) => f);

  // The colocated tests DO import vitest. They are excluded from the emit
  // program by tsconfig.build.json, which is the whole reason the rule is
  // spelled over the program rather than over the directory.
  assert.equal(findings.length, 1);
  assert.match(findings[0], /vitest/);
});

// ── Rule 3: the engine stays off the pad ─────────────────────────────────────

test('rule 3 fires when a pad-reachable workspace declares the engine', () => {
  const read = (path) => {
    if (String(path).endsWith('package.json')) {
      return JSON.stringify({ dependencies: { '@myclash/rulesets': 'workspace:^' } });
    }
    return '';
  };
  const { findings } = findEngineOnThePad(['apps/web-staff'], read, (f) => f);

  assert.ok(findings.length >= 1);
  assert.match(findings[0], /declares @myclash\/rulesets/);
  assert.match(findings[0], /7\.3/);
});

test('rule 3 fires on an import even when the manifest is clean', () => {
  // The two halves fail independently: the hoisted store resolves an undeclared
  // import anyway, so it would ship.
  const read = (path) => {
    if (String(path).endsWith('package.json')) return JSON.stringify({ dependencies: {} });
    return "import { TF_v1 } from '@myclash/rulesets';";
  };
  const { findings } = findEngineOnThePad(['apps/web-staff'], read, (f) => f);

  assert.ok(
    findings.some((f) => /imports @myclash\/rulesets/.test(f)),
    `expected an import finding, got ${JSON.stringify(findings)}`,
  );
});

test('rule 3 catches a subpath import too', () => {
  const read = (path) => {
    if (String(path).endsWith('package.json')) return JSON.stringify({});
    return "import { bergerSchedule } from '@myclash/rulesets/dist/scheduling/index';";
  };
  const { findings } = findEngineOnThePad(['apps/web-staff'], read, (f) => f);

  assert.ok(findings.some((f) => /imports @myclash\/rulesets/.test(f)));
});

test('rule 3 counts the directories it walked, so a rename cannot shrink the scan', () => {
  const read = (path) => (String(path).endsWith('package.json') ? '{}' : '');
  const { dirsWalked } = findEngineOnThePad(PAD_REACHABLE, read);

  // apps/web-staff has src/ and app/; packages/ui has src/ only.
  assert.equal(dirsWalked, 3);
});

// ── Rule 4: the pad runs only allowlisted arithmetic ─────────────────────────

const DOC = [
  '#### What arithmetic the pad IS allowed',
  '',
  'Prose the parser must skip.',
  '',
  '| Function                                    | The pad uses it to |',
  '| ------------------------------------------- | ------------------ |',
  '| `computeAfterblowDeltas` (`@myclash/rules`) | net a queued hit   |',
  '| `penaltyScoreDelta` + the per-card columns  | price a card       |',
  '',
  // A SHALLOWER heading on purpose. In the real document the next heading after
  // the allowlist is `## 7bis`, not a `####`, and an earlier draft searched only
  // for a deeper one — so it ran straight past and swallowed the referee-role
  // and phase-type tables below. A `####` here would let that bug pass.
  '## The next section',
  '',
  '| Role            | Meaning              |',
  '| --------------- | -------------------- |',
  '| `arbitre_table` | not a pad permission |',
].join('\n');

test('parseAllowlist reads the table and stops at the next heading', () => {
  const allowed = parseAllowlist(DOC);

  assert.deepEqual([...allowed].sort(), ['computeAfterblowDeltas', 'penaltyScoreDelta']);
  // The referee-role table below the next heading is NOT a pad permission. An
  // earlier draft searched only for a DEEPER heading, ran past `## 7bis` and
  // swallowed two unrelated tables — nine entries instead of four.
  assert.equal(allowed.has('arbitre_table'), false);
});

test('parseAllowlist ignores a backticked package name in the cell', () => {
  // `@myclash/rules` appears in the first cell as context. Granting it would
  // permit a whole package rather than a function.
  assert.equal(parseAllowlist(DOC).has('@myclash/rules'), false);
});

test('parseAllowlist throws when the heading it anchors on is gone', () => {
  assert.throws(() => parseAllowlist('# Another document\n\nNo allowlist here.\n'), /cannot find/u);
});

test('parseAllowlist throws rather than permitting everything on an empty table', () => {
  const gutted = '#### What arithmetic the pad IS allowed\n\nThe table was deleted.\n';

  assert.throws(() => parseAllowlist(gutted), /zero entries/u);
});

test('valueBindingsFromRules reports values and ignores types', () => {
  const source = [
    "import { computeAfterblowDeltas } from '@myclash/rules';",
    "import type { AfterblowMode } from '@myclash/rules';",
    "import { evaluateFormula, type FormulaNode } from '@myclash/rules';",
    "export { renderFormula } from '@myclash/rules';",
    "export type { MatchFormatConfig } from '@myclash/rules';",
    "import { unrelated } from '@myclash/types';",
  ].join('\n');

  assert.deepEqual(valueBindingsFromRules(source).sort(), [
    'computeAfterblowDeltas',
    'evaluateFormula',
    'renderFormula',
  ]);
});

test('valueBindingsFromRules follows a renamed binding to its source name', () => {
  assert.deepEqual(
    valueBindingsFromRules("import { evaluateFormula as run } from '@myclash/rules';"),
    ['evaluateFormula'],
  );
});

test('rule 4 fires on a value the allowlist does not name', () => {
  const read = () => "export { evaluateFormula } from '@myclash/rules';";
  const { findings, filesRead } = findUnallowedPadArithmetic(
    new Set(['computeAfterblowDeltas']),
    ['/repo/packages/types/src/scoring-config.ts'],
    read,
    (f) => f,
  );

  assert.equal(filesRead, 1);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /evaluateFormula/u);
  assert.match(findings[0], /7\.3/u);
});

test('rule 4 stays quiet for an allowlisted value', () => {
  const read = () => "export { computeAfterblowDeltas } from '@myclash/rules';";
  const { findings } = findUnallowedPadArithmetic(
    new Set(['computeAfterblowDeltas']),
    ['/x.ts'],
    read,
    (f) => f,
  );

  assert.deepEqual(findings, []);
});

test('rule 4 covers the re-exporter, not only the pad workspaces', () => {
  // A value reaches the pad just as surely through @myclash/types, which every
  // pad surface imports freely. Scanning only apps/web-staff would miss it, and
  // that is the route the one real crossing takes today.
  const files = padImportSurface().map((f) => f.split('\\').join('/'));

  assert.ok(
    files.some((f) => f.includes(`${RE_EXPORTER}/src/`)),
    `${RE_EXPORTER} must be in the surface rule 4 reads`,
  );
  assert.ok(files.some((f) => f.includes('apps/web-staff/src/')));
});

test('the real allowlist is exactly the four rows of the 7.3 table', () => {
  const allowed = parseAllowlist(readFileSync(ALLOWLIST_DOC, 'utf8'));

  // Pinned as a SET, not by spot-checks. A parser that over-reads still contains
  // computeAfterblowDeltas and still lacks evaluateFormula, so asserting only
  // those two would pass on a slice that swallowed the two tables below.
  assert.deepEqual([...allowed].sort(), [
    'computeAfterblowDeltas',
    'computePenaltySanction',
    'penaltyScoreDelta',
    'resolveEntryCard',
  ]);
  assert.equal(allowed.has('evaluateFormula'), false, 'the pad must never derive a score');
});

// ── The real repo ────────────────────────────────────────────────────────────

test('the repo is pure right now', () => {
  const { findings, scanned, emitted, dirsWalked, allowed, padFilesRead } = scanRepo();

  assert.deepEqual(findings, []);
  assert.ok(emitted > 0, `${PURE_PACKAGE} emitted nothing — the tsconfig or the walk is broken`);
  assert.ok(allowed > 0, 'the allowlist parsed to nothing');
  assert.ok(padFilesRead > 0, 'rule 4 read no files');
  assert.equal(scanned, 1 + emitted + dirsWalked + allowed + padFilesRead);
});

test('the gate reports what it saw', () => {
  const result = gate.run({ argv: [] });

  assert.deepEqual(result.findings, []);
  assert.match(result.summary, /declares no runtime dependency/);
  assert.match(result.summary, new RegExp(FORBIDDEN_ON_THE_PAD.replace('/', '\\/')));
  assert.ok(result.scanned > 0);
});

// ── Registration ─────────────────────────────────────────────────────────────
//
// A new gate needs FOUR registrations. The first three are checked here; the
// fourth, CONTRIBUTING.md, is convention only — gates.drift.test.ts compares
// ci.yml against CI_GATES in both directions and never opens it.

test('package.json exposes the gate on its own, not behind another script', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));

  assert.equal(
    manifest.scripts?.['quality:package-purity'],
    'node scripts/check-package-purity.mjs',
  );
});

test('CI runs the gate as its own step', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');

  assert.ok(ci.includes('pnpm quality:package-purity'), 'CI lint job must run the gate');
  assert.ok(
    !/&&\s*pnpm quality:package-purity/.test(ci),
    'quality:package-purity must be its own step, never &&-chained behind another gate — that shape hid eight gates for six weeks',
  );
  assert.ok(
    /- name: Check package purity\n\s+if: '!cancelled\(\)'/.test(ci),
    "the step needs if: '!cancelled()' or an earlier failure skips it",
  );
});

test('the API carries the step in CI_GATES', () => {
  const gates = readFileSync('apps/api/src/modules/admin/ci-health/gates.ts', 'utf8');

  assert.ok(
    gates.includes("step: 'Check package purity'"),
    'add the step to CI_GATES in apps/api, or the gate-health card cannot report it when it stops running',
  );
});

test('importing the gate does not run it', () => {
  assert.equal(process.exitCode, undefined);
});
