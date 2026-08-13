import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { toRepoPath, walkRepoFiles } from './lib/repo-scan.mjs';

const root = process.cwd();
const scannedRoots = ['apps/api/src', 'packages'];
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

const violations = [];
for (const scannedRoot of scannedRoots) {
  const absoluteRoot = join(root, scannedRoot);
  for (const file of walkRepoFiles(absoluteRoot, { extensions: ['.ts'] })) {
    const repoPath = toRepoPath(file);
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
