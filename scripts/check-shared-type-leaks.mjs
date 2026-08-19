import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { defineGate } from './lib/gate.mjs';
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

/** Every explicit `any` in one file. */
export function findAnyLeaks(source, repoPath) {
  const found = [];
  source.split(/\r?\n/).forEach((line, index) => {
    if (anyLeakPattern.test(line)) found.push(`${repoPath}:${index + 1}: ${line.trim()}`);
  });
  return found;
}

/**
 * The rule over a list of paths, with the reader injected for the test.
 *
 * `scanned` is counted AFTER ignoredFilePatterns, so it is the number of files
 * the rule could actually have found a leak in. Counting the walk's output
 * instead would report a healthy number even if every file were being skipped.
 */
export function scanForAnyLeaks(paths, read = readFileSync, label = toRepoPath) {
  const findings = [];
  let scanned = 0;

  for (const path of paths) {
    const repoPath = label(path);
    if (ignoredFilePatterns.some((pattern) => pattern.test(repoPath))) continue;
    scanned += 1;
    findings.push(...findAnyLeaks(read(path, 'utf8'), repoPath));
  }

  return { findings, scanned };
}

export const gate = defineGate({
  name: 'Explicit any leaks in shared and API production code',
  entry: import.meta.url,
  run: () => {
    const paths = scannedRoots.flatMap((scannedRoot) =>
      walkRepoFiles(join(root, scannedRoot), { extensions: ['.ts'] }),
    );
    const { findings, scanned } = scanForAnyLeaks(paths);
    return {
      findings,
      scanned,
      summary: `No explicit any leaks across ${scanned} shared/API production file(s).`,
      remedy:
        'Give the value its real type, or `unknown` plus a narrowing check. An `any` here is a\n' +
        'hole in a type the whole workspace reads.',
    };
  },
});
