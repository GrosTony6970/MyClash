import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = process.cwd();
const ignoredDirs = new Set([
  '.agents',
  '.claude',
  '.codex',
  '.git',
  '.kiro',
  '.next',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
]);
const extensions = new Set([
  '.cjs',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const allowedPathSuffixes = new Set([
  'docs/pre-production-review-plan.md',
  'docs/CODE_QUALITY_REVIEW.md',
  'memory/PROMPT_LOG.md',
  'scripts/check-todos.mjs',
]);
const allowedMarkers = [
  /\bT-\d+[a-z]?\b/i,
  /\bO-\d+\b/i,
  /BUILD_ORDER/,
  /OWNER_TASKS/,
  /https:\/\/github\.com\//,
];

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    if (ignoredDirs.has(entry)) return [];
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function hasAllowedExtension(path) {
  return [...extensions].some((extension) => path.endsWith(extension));
}

function normalize(path) {
  return relative(root, path).split(sep).join('/');
}

const violations = [];
for (const file of walk(root).filter(hasAllowedExtension)) {
  const repoPath = normalize(file);
  const source = readFileSync(file, 'utf8');
  source.split(/\r?\n/).forEach((line, index) => {
    if (!/\b(TODO|FIXME)\b/i.test(line)) return;
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
