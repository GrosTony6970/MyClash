import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = process.cwd();
const scannedRoots = ['apps/api/src', 'packages'];
const ignoredDirs = new Set(['coverage', 'dist', 'node_modules']);
const ignoredFilePatterns = [
  /\.test\.ts$/,
  /\.test\.tsx$/,
  /\.spec\.ts$/,
  /\.spec\.tsx$/,
  /tournament-query\.types\.ts$/,
  /tournament-query\.tools\.ts$/,
  /tournament-query\.tools\.service\.ts$/,
];
const anyLeakPattern = /(^|[^\w])((as|:)\s+any\b|<any>|\bany\[\])/;

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    if (ignoredDirs.has(entry)) return [];
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function normalize(path) {
  return relative(root, path).split(sep).join('/');
}

const violations = [];
for (const scannedRoot of scannedRoots) {
  const absoluteRoot = join(root, scannedRoot);
  for (const file of walk(absoluteRoot).filter((path) => path.endsWith('.ts'))) {
    const repoPath = normalize(file);
    if (ignoredFilePatterns.some((pattern) => pattern.test(repoPath))) continue;
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .forEach((line, index) => {
        if (anyLeakPattern.test(line)) {
          violations.push(`${repoPath}:${index + 1}: ${line.trim()}`);
        }
      });
  }
}

if (violations.length) {
  console.error('Explicit any leaks found in shared/API production code:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log('No explicit any leaks found in shared/API production code.');
