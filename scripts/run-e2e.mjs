import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * What Playwright's output says so far: 'passed', 'failed' or 'pending'.
 *
 * Exported so it can be tested — importing this module runs nothing (see the
 * entry guard at the bottom), which is the lesson `scripts/lib/gate.mjs` states
 * at length: export is the only thing standing between a script and a test.
 *
 * It matches the EPILOGUE lines, anchored to the start of a line
 * (`generateSummaryMessage`, playwright 1.62.1 `lib/runner/index.js:1183`).
 * The old check was `output.includes('passed')` over the whole stream so far,
 * so a test whose TITLE carried the word armed the kill timer mid-run — before
 * a reporter had written anything — and the suite died green. A per-test line
 * never starts with a bare count, so the anchor tells the two apart.
 *
 * 'failed' is the answer for any epilogue that is not a clean pass, and the
 * epilogue prints `failed` first anyway. `interrupted` and `did not run` are in
 * there because Ctrl+C on a local run prints them beside a `passed` count, and
 * that run did not finish.
 */
export function playwrightVerdict(output) {
  // Colour, when someone sets FORCE_COLOR, sits between the line start and the
  // count, so it has to come off before the anchor can hold.
  const plain = output.replace(/\u001B\[[0-9;]*m/g, '');
  if (/^\s*\d+\s+(failed|interrupted|did not run)\b/m.test(plain)) return 'failed';
  if (/^\s*\d+\s+passed\b/m.test(plain)) return 'passed';
  return 'pending';
}

/**
 * A hang guard, NOT a time budget.
 *
 * It was two minutes, and that killed every CI run of this job before the suite
 * could finish — three runs in a row ended at 133-140 s, the report was never
 * written, and the job reported a test failure that had not happened. The suite
 * is 53 s here on a cold `.next`. Those CI runs were not doing that work: every
 * page they opened was a 500 (see `waitForServer`), and each test waited out
 * its own timeout on it. So the number has to be one no healthy run can reach,
 * and its only job is to stop a wedged browser from holding the runner for the
 * job's default six hours.
 */
const HANG_GUARD_MS = 600_000;

/**
 * How long the runner waits, after Playwright's epilogue, for Playwright to
 * exit on its own before killing it.
 *
 * ── Which path settles a run ────────────────────────────────────────────────
 * Two can: `child.once('exit')`, carrying Playwright's own exit code, and this
 * timer, carrying the parsed verdict. Measured on the real suite with a probe
 * on both: the child's exit wins every time, at once, and this timer has not
 * been seen to fire. It is the fallback for a Playwright that reports and then
 * lingers — the reason it was written — and it is why `playwright.config.ts`
 * lists the html reporter before `list`, so the report is on disk before the
 * epilogue that arms this can print.
 */
const SUMMARY_EXIT_GRACE_MS = 2_000;

const servers = [
  {
    name: 'web-public',
    args: [
      'apps/web-public/node_modules/next/dist/bin/next',
      'dev',
      'apps/web-public',
      '--port',
      '3001',
    ],
    url: 'http://localhost:3001',
  },
  {
    name: 'web-staff',
    args: [
      'apps/web-staff/node_modules/next/dist/bin/next',
      'dev',
      'apps/web-staff',
      '--port',
      '3002',
    ],
    url: 'http://localhost:3002',
  },
  {
    name: 'web-admin',
    args: [
      'apps/web-admin/node_modules/next/dist/bin/next',
      'dev',
      'apps/web-admin',
      '--port',
      '3003',
    ],
    url: 'http://localhost:3003',
  },
];

const children = [];

/**
 * Resolves once a server answers its home page, and rejects at once on a 5xx.
 *
 * Any answer used to count as ready. A dev server that cannot compile still
 * answers — `GET / 500` with Next's error page — so the suite ran against it:
 * in CI, 21 of 23 tests timed out on blank pages for weeks, because the
 * package artifact had no dist for three packages the apps import. A healthy
 * home page answers 200, or 307 where it redirects to sign-in. A compile error
 * does not clear by waiting, so a 5xx is not retried.
 */
export function waitForServer(server, timeoutMs = 60_000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const poll = () => {
      const request = http.get(server.url, (response) => {
        response.resume();
        if (response.statusCode >= 500) {
          reject(
            new Error(
              `${server.name} answered ${response.statusCode} at ${server.url}; its dev server output in the job log says why`,
            ),
          );
          return;
        }
        resolve();
      });

      request.on('error', () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for ${server.name} at ${server.url}`));
          return;
        }
        setTimeout(poll, 500);
      });

      request.setTimeout(2_000, () => {
        request.destroy();
      });
    };

    poll();
  });
}

function spawnServer(server) {
  const child = spawn(process.execPath, server.args, {
    stdio: 'inherit',
    env: {
      // Placeholder Supabase client env. `getSupabaseBrowser()` THROWS when
      // these are unset, and it is called from the realtime effect the schedule
      // grid mounts — so without them that page dies in its error boundary
      // before a single test can look at it, and the suite could only ever
      // cover surfaces with no realtime. Nothing here connects: the host is
      // unroutable, the socket fails, and the grid falls back to polling, which
      // is the state these tests want anyway.
      //
      // Real values are a build-time contract in prod (see `quality:client-env`),
      // so this only fills the gap in the local/CI harness.
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'e2e-harness-placeholder-anon-key',
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
    },
    detached: process.platform !== 'win32',
  });

  child.once('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`${server.name} exited early with code ${code}`);
    }
  });

  children.push(child);
  return child;
}

function runPlaywright() {
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['exec', 'playwright', 'test'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    let settled = false;
    let output = '';
    let summaryExitTimer;
    const watchdogTimer = setTimeout(() => {
      // Always 1: an epilogue would have settled ten minutes before this.
      console.error(`Playwright hang guard fired after ${HANG_GUARD_MS / 1000}s — no summary.`);
      void killChild(child);
      settle(1);
    }, HANG_GUARD_MS);

    const settle = (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(watchdogTimer);
      clearTimeout(summaryExitTimer);
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      resolve(code);
    };

    const handleOutput = (chunk, stream) => {
      const text = chunk.toString();
      output += text;
      stream.write(text);

      if (playwrightVerdict(output) !== 'pending' && !summaryExitTimer) {
        summaryExitTimer = setTimeout(() => {
          void killChild(child);
          settle(playwrightVerdict(output) === 'passed' ? 0 : 1);
        }, SUMMARY_EXIT_GRACE_MS);
      }
    };

    child.stdout.on('data', (chunk) => handleOutput(chunk, process.stdout));
    child.stderr.on('data', (chunk) => handleOutput(chunk, process.stderr));

    child.once('exit', (code) => settle(code ?? 1));
  });
}

function killChild(child) {
  if (!child.pid || child.killed) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const fallback = setTimeout(resolve, 5_000);
    child.unref();

    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
      killer.once('exit', () => {
        clearTimeout(fallback);
        resolve();
      });
      return;
    }

    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        // Process already exited.
      }
    }
    setTimeout(() => {
      clearTimeout(fallback);
      resolve();
    }, 500);
  });
}

async function main() {
  for (const server of servers) {
    spawnServer(server);
  }

  try {
    await Promise.all(servers.map((server) => waitForServer(server)));
    const exitCode = await runPlaywright();
    process.exitCode = exitCode;
  } finally {
    await Promise.all(children.map((child) => killChild(child)));
  }
}

// Only when this file IS the command. `scripts/run-e2e.test.mjs` imports
// `playwrightVerdict` and `waitForServer` from here, and importing them must
// not boot three dev servers (`scripts/lib/gate.mjs` spells out why every
// script needs this).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(async (error) => {
    console.error(error);
    // The job log that holds the line above needs admin rights to read; check-run
    // annotations are public. An annotation shows the message's first line.
    console.error(`::error title=E2E runner::${error.message}`);
    await Promise.all(children.map((child) => killChild(child)));
    process.exit(1);
  });
}
