import { readFileSync } from 'node:fs';

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
  'docs/pre-production-review-plan.md',
  'docs/CODE_QUALITY_REVIEW.md',
  'docs/DOC_REVIEW_2026-07-01.md',
  'scripts/check-todos.mjs',
]);
const allowedMarkers = [
  /\bT-\d+[a-z]?\b/i,
  /\bO-\d+\b/i,
  /BUILD_ORDER/,
  /OWNER_TASKS/,
  /https:\/\/github\.com\//,
];

const violations = [];
for (const file of walkRepoFiles(root, { extensions })) {
  const repoPath = toRepoPath(file);
  if (ignoredPathPrefixes.some((prefix) => repoPath.startsWith(prefix))) continue;
  const source = readFileSync(file, 'utf8');
  source.split(/\r?\n/).forEach((line, index) => {
    // Case-SENSITIVE on purpose. The debt marker is conventionally uppercase, and
    // matching case-insensitively flags things that are not markers at all:
    // ai-data-quality.service.ts lists 'todo' as a placeholder WORD to detect
    // ('test', 'demo', 'sample', 'todo', 'tbd'), and tests/e2e uses `test.fixme`.
    // Both are code, not debt; neither can be fixed by adding a task marker.
    if (!/\b(TODO|FIXME)\b/.test(line)) return;
    const allowed =
      allowedPathSuffixes.has(repoPath) || allowedMarkers.some((marker) => marker.test(line));
    if (!allowed) {
      violations.push(`${repoPath}:${index + 1}: ${line.trim()}`);
    }
  });
}

if (violations.length) {
  console.error('Untracked TODO/FIXME comments found. Add a task marker or remove the debt:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log('TODO/FIXME comments are either absent or tied to explicit review/task references.');
