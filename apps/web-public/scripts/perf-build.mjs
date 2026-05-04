import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const result = spawnSync(pnpm, ['--dir', '../..', '--filter', '@myclash/web-public', 'build'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: {
    ...process.env,
    MYCLASH_NEXT_OUTPUT: 'default',
  },
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
