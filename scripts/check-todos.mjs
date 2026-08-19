import { readFileSync } from 'node:fs';

import { defineGate } from './lib/gate.mjs';
import { toRepoPath, walkRepoFiles } from './lib/repo-scan.mjs';

const root = process.cwd();
const extensions = ['.cjs', '.js', '.jsx', '.json', '.md', '.mjs', '.ts', '.tsx', '.yaml', '.yml'];
// Same rationale as the tool-cache entries in REPO_IGNORED_DIRS, but these need
// a PATH prefix rather than a directory name: `plans` / `specs` / `archive` are
// far too generic to ignore as bare segment names. These hold session planning
// artefacts, whose prose discusses TODOs — including, unavoidably, sentences
// asserting a plan contains none ("Placeholder scan: No TBD/TODO"). That is a
// claim about debt, not debt, and it cannot be fixed by adding a task marker.
const ignoredPathPrefixes = ['docs/superpowers/'];
const allowedPathSuffixes = new Set([
  'docs/CODE_QUALITY_REVIEW.md',
  // This gate and its test both have to SPELL the markers they look for. The
  // test file is the sharper case: every fixture proving a marker is caught is
  // itself a marker, so a gate that scanned its own test could never be tested.
  'scripts/check-todos.mjs',
  'scripts/check-todos.test.mjs',
]);
const allowedMarkers = [
  /\bT-\d+[a-z]?\b/i,
  /\bO-\d+\b/i,
  /BUILD_ORDER/,
  /OWNER_TASKS/,
  /https:\/\/github\.com\//,
];

/** Every untracked debt marker in one file. */
export function findDebtMarkers(source, repoPath) {
  if (allowedPathSuffixes.has(repoPath)) return [];

  const found = [];
  source.split(/\r?\n/).forEach((line, index) => {
    // Case-SENSITIVE on purpose. The debt marker is conventionally uppercase, and
    // matching case-insensitively flags things that are not markers at all:
    // ai-data-quality.service.ts lists 'todo' as a placeholder WORD to detect
    // ('test', 'demo', 'sample', 'todo', 'tbd'), and tests/e2e uses `test.fixme`.
    // Both are code, not debt; neither can be fixed by adding a task marker.
    if (!/\b(TODO|FIXME)\b/.test(line)) return;
    if (allowedMarkers.some((marker) => marker.test(line))) return;
    found.push(`${repoPath}:${index + 1}: ${line.trim()}`);
  });
  return found;
}

/**
 * The rule over a list of paths, with the reader injected so the test can run it
 * without a filesystem.
 *
 * `scanned` counts files the rule actually read. The prefix-ignored ones are
 * skipped before that, so they do not inflate the number the harness checks for
 * an empty scan; the allowlisted ones ARE read and simply cannot produce a
 * finding, so they do.
 */
export function scanForDebtMarkers(paths, read = readFileSync, label = toRepoPath) {
  const findings = [];
  let scanned = 0;

  for (const path of paths) {
    const repoPath = label(path);
    if (ignoredPathPrefixes.some((prefix) => repoPath.startsWith(prefix))) continue;
    scanned += 1;
    findings.push(...findDebtMarkers(read(path, 'utf8'), repoPath));
  }

  return { findings, scanned };
}

export const gate = defineGate({
  name: 'Untracked debt markers',
  entry: import.meta.url,
  run: () => {
    const { findings, scanned } = scanForDebtMarkers(walkRepoFiles(root, { extensions }));
    return {
      findings,
      scanned,
      summary: `TODO/FIXME comments across ${scanned} file(s) are either absent or tied to explicit review/task references.`,
      remedy:
        'Add a task marker — T-NNN, O-NNN, BUILD_ORDER, OWNER_TASKS or a GitHub issue link — or remove the debt.',
    };
  },
});
