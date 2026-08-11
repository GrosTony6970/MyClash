#!/usr/bin/env node
/**
 * scripts/rollback.ts
 *
 * Cross-platform rollback command, the sibling of `scripts/deploy.ts`. Run from
 * the owner's machine as `pnpm rollback:prod`.
 *
 * `package.json` has wired `rollback:prod` at this path since the deploy tooling
 * landed, but the file did not exist — so the one command you reach for during
 * an incident failed with "Cannot find module". Both scripts READMEs promised it
 * and `docs/OBSERVABILITY_REVIEW.md` named it as step 1 of the rollback runbook.
 *
 * Reads the same `.env.deploy` as deploy.ts (one owner for that contract), then:
 *   1. SSH to the VPS with a TTY
 *   2. Run: cd <repo> && bash infra/scripts/rollback.sh
 *   3. Stream output back, including the script's confirmation prompt
 *   4. Re-run the same post-deploy verification deploy.ts uses
 *
 * `infra/scripts/rollback.sh` takes NO arguments and CONFIRMS before doing
 * anything destructive, so a TTY is mandatory rather than opportunistic — see
 * requireTty below.
 */

import { spawn } from 'node:child_process';
import process from 'node:process';

import { type DeployEnv, loadEnv, postDeployChecks } from './deploy.ts';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const ok = (m: string) => console.log(`${GREEN}✓${RESET} ${m}`);
const err = (m: string) => console.error(`${RED}✗${RESET} ${m}`);
const warn = (m: string) => console.log(`${YELLOW}!${RESET} ${m}`);
const hdr = (m: string) => console.log(`\n${CYAN}${BOLD}── ${m} ──${RESET}`);

/**
 * rollback.sh restores Postgres from a backup and `git reset --hard`s the
 * checkout. It asks before doing either. Without a TTY that prompt reads EOF and
 * the script either aborts or — far worse — proceeds unattended, so refuse up
 * front rather than discover it mid-incident.
 */
function requireTty(): void {
  if (process.stdin.isTTY && process.stdout.isTTY) return;
  err('Rollback needs an interactive terminal: rollback.sh confirms before restoring the');
  err('database and resetting the checkout, and that prompt cannot be answered without a TTY.');
  err('Run this directly from a shell, or SSH in and run infra/scripts/rollback.sh yourself.');
  process.exit(1);
}

function runSSH(env: DeployEnv, remoteCmd: string): Promise<number> {
  return new Promise((resolvePromise) => {
    const args = [
      '-t', // forced, not conditional — see requireTty
      '-i',
      env.sshKeyPath,
      '-o',
      'StrictHostKeyChecking=accept-new',
      `${env.user}@${env.host}`,
      remoteCmd,
    ];
    const proc = spawn('ssh', args, { stdio: 'inherit' });
    proc.on('exit', (code) => resolvePromise(code ?? 1));
  });
}

async function main() {
  const dryRun = process.argv.slice(2).includes('--dry-run');

  hdr('MyClash rollback');
  const env = loadEnv();
  console.log(`  Host:     ${env.user}@${env.host}`);
  console.log(`  Repo:     ${env.repoPath}`);
  console.log(`  SSH key:  ${env.sshKeyPath}`);
  console.log(`  Smoke:    ${env.smokeUrl}`);
  console.log(`  Edge:     ${env.edgeDomain}${env.allowStagingCert ? ' (staging cert OK)' : ''}`);

  const remoteCmd = `cd ${env.repoPath} && bash infra/scripts/rollback.sh`;

  if (dryRun) {
    warn('Dry run — nothing will execute on the VPS.');
    console.log(`\nWould run on VPS:\n  ${remoteCmd}`);
    console.log(`Would then verify: node scripts/check-edge-tls.mjs --domain ${env.edgeDomain}`);
    return;
  }

  warn('This restores Postgres from the pre-deploy backup and resets the checkout.');
  warn('rollback.sh will ask you to confirm before it touches anything.');

  requireTty();

  hdr('Running rollback on VPS (output streaming)');
  const code = await runSSH(env, remoteCmd);

  if (code !== 0) {
    err(`Remote rollback exited with code ${code}`);
    process.exit(code);
  }

  // A rollback changes what is being served just as much as a deploy does, so it
  // gets the same verification rather than trusting the remote smoke test alone.
  const failures = await postDeployChecks(env);

  if (failures.length > 0) {
    hdr('Rollback finished with failures');
    for (const failure of failures) err(failure);
    err('The rollback ran but the result is NOT verified.');
    process.exit(1);
  }

  hdr('Rollback complete');
  ok('Previous version restored and verified.');
}

// Guarded so a test can import this module without SSHing anywhere — same
// pattern and reason as deploy.ts.
const invokedDirectly = process.argv[1]?.endsWith('rollback.ts') ?? false;
if (invokedDirectly) {
  main().catch((e) => {
    err(String(e));
    process.exit(1);
  });
}

export { main, requireTty };
