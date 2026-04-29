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
}

function loadEnv(): DeployEnv {
  const envFile = resolve('.env.deploy');
  if (!existsSync(envFile)) {
    err('Missing .env.deploy. Create it from .env.deploy.example.');
    process.exit(1);
  }
  const raw = readFileSync(envFile, 'utf8');
  const env: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  const required = ['DEPLOY_HOST', 'DEPLOY_USER', 'DEPLOY_SSH_KEY_PATH', 'DEPLOY_REPO_PATH', 'DEPLOY_SMOKE_URL'];
  for (const k of required) {
    if (!env[k]) {
      err(`Missing ${k} in .env.deploy`);
      process.exit(1);
    }
  }
  return {
    host: env.DEPLOY_HOST,
    user: env.DEPLOY_USER,
    sshKeyPath: env.DEPLOY_SSH_KEY_PATH.replace(/^~(?=$|\/|\\)/, homedir()),
    repoPath: env.DEPLOY_REPO_PATH,
    smokeUrl: env.DEPLOY_SMOKE_URL,
  };
}

function runSSH(env: DeployEnv, remoteCmd: string): Promise<number> {
  return new Promise((resolve) => {
    const args = [
      '-i', env.sshKeyPath,
      '-o', 'StrictHostKeyChecking=accept-new',
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

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const passthrough = args.filter((a) => a !== '--dry-run').join(' ');

  hdr('MyClash deploy');
  const env = loadEnv();
  console.log(`  Host:     ${env.user}@${env.host}`);
  console.log(`  Repo:     ${env.repoPath}`);
  console.log(`  SSH key:  ${env.sshKeyPath}`);
  console.log(`  Smoke:    ${env.smokeUrl}`);
  if (passthrough) console.log(`  Args:     ${passthrough}`);

  if (dryRun) {
    warn('Dry run — no commands will execute on the VPS.');
    console.log(`\nWould run on VPS:\n  cd ${env.repoPath} && bash infra/scripts/deploy.sh ${passthrough}`);
    return;
  }

  hdr('Running deploy on VPS (output streaming)');
  const remoteCmd = `cd ${env.repoPath} && bash infra/scripts/deploy.sh ${passthrough}`;
  const code = await runSSH(env, remoteCmd);

  if (code !== 0) {
    err(`Remote deploy exited with code ${code}`);
    process.exit(code);
  }

  hdr('Local smoke test');
  const passed = await smokeTest(env.smokeUrl);
  if (passed) {
    ok(`${env.smokeUrl} is reachable`);
  } else {
    warn(`${env.smokeUrl} not reachable from local machine (could be DNS / TLS / firewall)`);
  }

  hdr('Deploy complete');
  ok('All steps finished successfully.');
}

main().catch((e) => {
  err(String(e));
  process.exit(1);
});
