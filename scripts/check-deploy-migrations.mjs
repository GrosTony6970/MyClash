import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { defineGate } from './lib/gate.mjs';
import { listMigrationFiles } from './lib/migrations.mjs';

/**
 * Reads the two logs of CI's `Deploy migration run` job and says whether the
 * deploy's own migration run behaved (ruling 386).
 *
 * Production applies migrations with packages/db/scripts/migrate.mjs, from the
 * built api image, through infra/scripts/deploy.sh. The Database replay job
 * applies them with another script, so a change to migrate.mjs, to postgres.js
 * or to what the image copies reached production untested. The job runs the
 * deploy's command twice on a fresh database; this checks the two runs:
 *
 * - the first applied every migration file and skipped none;
 * - the second applied none and skipped every one (the ledger holds them all);
 * - both counted as many files as the repo holds (the image copied them all).
 *
 * The file count comes from the repo through `listMigrationFiles`, the same
 * filter migrate.mjs uses, never a number written here.
 */

// migrate.mjs's last line. A run that crashed never prints it.
const SUMMARY = /^Migrations complete: (\d+) applied, (\d+) skipped, (\d+) total\.$/mu;

/** The counts a run printed, or null when it printed no summary. */
export function readRunSummary(log) {
  const match = SUMMARY.exec(log);
  if (!match) return null;
  return { applied: Number(match[1]), skipped: Number(match[2]), total: Number(match[3]) };
}

/** What went wrong across the two runs, given how many migration files the repo holds. */
export function deployMigrationFindings(firstLog, secondLog, fileCount) {
  const runs = [
    { label: 'first', log: firstLog, applied: fileCount, skipped: 0 },
    { label: 'second', log: secondLog, applied: 0, skipped: fileCount },
  ];
  const findings = [];
  for (const run of runs) {
    const got = readRunSummary(run.log);
    if (!got) {
      findings.push(`The ${run.label} run printed no "Migrations complete" line.`);
      continue;
    }
    if (got.total !== fileCount) {
      findings.push(
        `The ${run.label} run counted ${got.total} migration files; the repo holds ${fileCount}.`,
      );
    }
    if (got.applied !== run.applied || got.skipped !== run.skipped) {
      findings.push(
        `The ${run.label} run applied ${got.applied} and skipped ${got.skipped}; ` +
          `expected ${run.applied} applied and ${run.skipped} skipped.`,
      );
    }
  }
  return findings;
}

export const gate = defineGate({
  name: 'Deploy migration run',
  entry: import.meta.url,
  run: ({ argv }) => {
    const [firstPath, secondPath] = argv;
    if (!firstPath || !secondPath) {
      return {
        findings: ['Usage: node scripts/check-deploy-migrations.mjs <first log> <second log>'],
        scanned: 0,
        summary: 'No logs given.',
      };
    }
    const fileCount = listMigrationFiles(
      join(process.cwd(), 'packages', 'db', 'migrations'),
    ).length;
    return {
      findings: deployMigrationFindings(
        readFileSync(firstPath, 'utf8'),
        readFileSync(secondPath, 'utf8'),
        fileCount,
      ),
      scanned: fileCount,
      summary: `The deploy's migration run applied, then skipped, all ${fileCount} migration files.`,
      remedy:
        'Production runs this same command at every deploy (infra/scripts/deploy.sh). Read the\n' +
        "job's log above: a failing file, a file the image did not copy, or a ledger row that\n" +
        'migrate.mjs did not write each break the next deploy.',
    };
  },
});
