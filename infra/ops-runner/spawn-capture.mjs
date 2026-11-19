import { spawn } from 'node:child_process';

/**
 * Runs a command and captures its output, killing it after `timeoutMs` with a `timedOut: true`
 * flag, so a caller can tell "exited non-zero" from "we never heard back".
 *
 * `maxChars` bounds what is held in memory: stdout keeps only its LAST `maxChars` characters as it
 * grows, and `capped: true` says something was dropped (its first line may then be cut). The
 * runner's 512m is shared with restores; a container log can be any size.
 */
export function spawnCaptureWithTimeout(command, args, timeoutMs, { maxChars, cwd } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: process.env });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let capped = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      if (maxChars !== undefined && stdout.length > maxChars) {
        stdout = stdout.slice(-maxChars);
        capped = true;
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, capped });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: error.message, timedOut, capped });
    });
  });
}
