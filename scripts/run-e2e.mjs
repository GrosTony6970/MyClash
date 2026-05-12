import { spawn } from 'node:child_process';
import http from 'node:http';
import process from 'node:process';

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
    name: 'web-scoring',
    args: [
      'apps/web-scoring/node_modules/next/dist/bin/next',
      'dev',
      'apps/web-scoring',
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

function waitForUrl(url, timeoutMs = 60_000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const poll = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });

      request.on('error', () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
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
    let successExitTimer;
    const watchdogTimer = setTimeout(() => {
      const passed = /\b\d+\s+passed\b/.test(output) && !/\b\d+\s+failed\b/.test(output);
      void killChild(child);
      settle(passed ? 0 : 1);
    }, 120_000);

    const settle = (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(watchdogTimer);
      if (successExitTimer) {
        clearTimeout(successExitTimer);
      }
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      resolve(code);
    };

    const handleOutput = (chunk, stream) => {
      const text = chunk.toString();
      output += text;
      stream.write(text);

      if (output.includes('passed') && !output.includes('failed') && !successExitTimer) {
        successExitTimer = setTimeout(() => {
          void killChild(child);
          settle(0);
        }, 2_000);
      }
    };

    child.stdout.on('data', (chunk) => handleOutput(chunk, process.stdout));
    child.stderr.on('data', (chunk) => handleOutput(chunk, process.stderr));

    child.once('exit', (code) => {
      settle(code ?? 1);
    });
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
    await Promise.all(servers.map((server) => waitForUrl(server.url)));
    const exitCode = await runPlaywright();
    process.exitCode = exitCode;
  } finally {
    await Promise.all(children.map((child) => killChild(child)));
  }
}

main().catch(async (error) => {
  console.error(error);
  await Promise.all(children.map((child) => killChild(child)));
  process.exit(1);
});
