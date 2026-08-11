#!/usr/bin/env node
/**
 * scripts/deploy.ts
 *
 * Cross-platform deploy command. Run from the owner's Windows / macOS / Linux machine.
 *
 * Reads `.env.deploy` (gitignored) for connection settings:
 *   DEPLOY_HOST=myclash.fr
 *   DEPLOY_USER=deploy
 *   DEPLOY_SSH_KEY_PATH=~/.ssh/myclash_ed25519
 *   DEPLOY_REPO_PATH=/srv/myclash
 *   DEPLOY_SMOKE_URL=https://api.myclash.fr/health
 *
 * Steps:
 *   1. SSH to VPS
 *   2. Run: cd <repo> && infra/scripts/deploy.sh [args]
 *   3. Stream output back to local terminal
 *   4. Smoke-test the public endpoint from the local machine
 *   5. Show summary
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

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

interface DeployEnv {
  host: string;
  user: string;
  sshKeyPath: string;
  repoPath: string;
  smokeUrl: string;
  /** Public domain for the post-deploy edge review. Defaults to DEPLOY_HOST. */
  edgeDomain: string;
  /** Optional. Absent → the edge review skips its realtime probe and says so. */
  supabaseAnonKey: string | null;
  /** DEPLOY_ALLOW_STAGING_CERT=1 while prod runs on `deploy.sh --dev-certs`. */
  allowStagingCert: boolean;
}

/** Exported so `scripts/rollback.ts` reads the same `.env.deploy` contract. */
export function loadEnv(): DeployEnv {
  const envFile = resolve('.env.deploy');
  if (!existsSync(envFile)) {
    err('Missing .env.deploy. Create it from .env.deploy.example.');
    process.exit(1);
  }
  const raw = readFileSync(envFile, 'utf8');
  const env: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m?.[1] && m[2] !== undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  const required = [
    'DEPLOY_HOST',
    'DEPLOY_USER',
    'DEPLOY_SSH_KEY_PATH',
    'DEPLOY_REPO_PATH',
    'DEPLOY_SMOKE_URL',
  ];
  for (const k of required) {
    if (!env[k]) {
      err(`Missing ${k} in .env.deploy`);
      process.exit(1);
    }
  }
  return {
    host: env['DEPLOY_HOST']!,
    user: env['DEPLOY_USER']!,
    sshKeyPath: env['DEPLOY_SSH_KEY_PATH']!.replace(/^~(?=$|\/|\\)/, homedir()),
    repoPath: env['DEPLOY_REPO_PATH']!,
    smokeUrl: env['DEPLOY_SMOKE_URL']!,
    edgeDomain: env['DEPLOY_EDGE_DOMAIN'] ?? env['DEPLOY_HOST']!,
    supabaseAnonKey: env['SUPABASE_ANON_KEY'] ?? null,
    allowStagingCert: env['DEPLOY_ALLOW_STAGING_CERT'] === '1',
  };
}

function runSSH(env: DeployEnv, remoteCmd: string): Promise<number> {
  return new Promise((resolve) => {
    const args = [
      ...(process.stdin.isTTY && process.stdout.isTTY ? ['-t'] : []),
      '-i',
      env.sshKeyPath,
      '-o',
      'StrictHostKeyChecking=accept-new',
      `${env.user}@${env.host}`,
      remoteCmd,
    ];
    const proc = spawn('ssh', args, { stdio: 'inherit' });
    proc.on('exit', (code) => resolve(code ?? 1));
  });
}

async function smokeTest(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url, { method: 'GET' });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Runs `scripts/check-edge-tls.mjs` against the deployed domain and streams its
 * output. Every host, not just one — HTTPS redirect, HSTS, certificate trust and
 * expiry, the API health route, and realtime tenant resolution on app.${domain}.
 *
 * The realtime probe needs SUPABASE_ANON_KEY (public — it ships in every browser
 * bundle); without it the script skips that one check and says so.
 */
function edgeReview(env: DeployEnv): Promise<boolean> {
  const args = ['scripts/check-edge-tls.mjs', '--domain', env.edgeDomain];
  if (env.allowStagingCert) args.push('--allow-staging-cert=1');
  const proc = spawn(process.execPath, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...(env.supabaseAnonKey ? { SUPABASE_ANON_KEY: env.supabaseAnonKey } : {}),
    },
  });
  return new Promise((resolve) => proc.on('exit', (code) => resolve(code === 0)));
}

/** Echo the resolved connection settings before anything touches the VPS. */
function printPlan(env: DeployEnv, passthrough: string): void {
  console.log(`  Host:     ${env.user}@${env.host}`);
  console.log(`  Repo:     ${env.repoPath}`);
  console.log(`  SSH key:  ${env.sshKeyPath}`);
  console.log(`  Smoke:    ${env.smokeUrl}`);
  console.log(`  Edge:     ${env.edgeDomain}${env.allowStagingCert ? ' (staging cert OK)' : ''}`);
  if (!env.supabaseAnonKey) {
    warn('SUPABASE_ANON_KEY absent from .env.deploy — the edge realtime probe will be skipped.');
  }
  if (passthrough) console.log(`  Args:     ${passthrough}`);
}

/** The two post-deploy probes, injectable so they can be faked in a test. */
export type { DeployEnv };

export interface DeployProbes {
  smoke: (url: string) => Promise<boolean>;
  edge: (env: DeployEnv) => Promise<boolean>;
}

/**
 * Post-deploy verification. Returns the list of failures instead of exiting, so
 * `main` keeps ownership of the exit code.
 *
 * BOTH probes always run, even when the first fails — collecting every failure
 * beats reporting the first one and hiding the rest. That is the same masking
 * bug the CI gate chain had, and it is worth not repeating here.
 */
export async function postDeployChecks(
  env: DeployEnv,
  probes: DeployProbes = { smoke: smokeTest, edge: edgeReview },
): Promise<string[]> {
  const failures: string[] = [];

  hdr('Local smoke test');
  if (await probes.smoke(env.smokeUrl)) {
    ok(`${env.smokeUrl} is reachable`);
  } else {
    err(`${env.smokeUrl} not reachable from local machine (could be DNS / TLS / firewall)`);
    failures.push(`smoke test: ${env.smokeUrl}`);
  }

  // Edge check, run from HERE and not from CI on purpose: admin.${domain} sits
  // behind a fail-closed geoblock allow-list, so only a machine in one of those
  // countries can assert the whole edge. This is also the moment it matters —
  // a compose or Traefik change has just landed.
  hdr('Edge / TLS review');
  if (await probes.edge(env)) {
    ok(`edge review passed for ${env.edgeDomain}`);
  } else {
    failures.push(`edge review: ${env.edgeDomain}`);
  }

  return failures;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const passthrough = args.filter((a) => a !== '--dry-run').join(' ');

  hdr('MyClash deploy');
  const env = loadEnv();
  printPlan(env, passthrough);

  if (dryRun) {
    warn('Dry run — no commands will execute on the VPS.');
    console.log(
      `\nWould run on VPS:\n  cd ${env.repoPath} && bash infra/scripts/deploy.sh ${passthrough}`,
    );
    console.log(`Would then verify: node scripts/check-edge-tls.mjs --domain ${env.edgeDomain}`);
    return;
  }

  hdr('Running deploy on VPS (output streaming)');
  const remoteCmd = `cd ${env.repoPath} && bash infra/scripts/deploy.sh ${passthrough}`;
  const code = await runSSH(env, remoteCmd);

  if (code !== 0) {
    err(`Remote deploy exited with code ${code}`);
    process.exit(code);
  }

  const failures = await postDeployChecks(env);

  if (failures.length > 0) {
    hdr('Deploy finished with failures');
    // The containers are up either way — the deploy itself succeeded. What
    // failed is the verification, and it exits non-zero so it cannot scroll
    // past: a websocket that 403'd for weeks is exactly what a warning buys.
    for (const failure of failures) err(failure);
    err('Post-deploy verification failed. The stack is deployed but NOT verified.');
    process.exit(1);
  }

  hdr('Deploy complete');
  ok('All steps finished successfully.');
}

// Guarded so scripts/deploy.test.mjs can import `postDeployChecks` without
// running a deploy. Same pattern (and same reason) as check-complexity.mjs.
// `deploy:prod` runs `tsx scripts/deploy.ts`, so argv[1] ends in deploy.ts.
const invokedDirectly = process.argv[1]?.endsWith('deploy.ts') ?? false;
if (invokedDirectly) {
  main().catch((e) => {
    err(String(e));
    process.exit(1);
  });
}
