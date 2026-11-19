/**
 * A cloud run reaches the internet only through the proxy named in `HTTPS_PROXY`. Node ignores
 * that variable unless `NODE_USE_ENV_PROXY=1` is set when it starts: without it, the door answered
 * `SELF_SIGNED_CERT_IN_CHAIN` and Resend `ENOTFOUND` in a cloud run (measured 2026-11-19); with
 * it, both answered like curl. So each script starts itself again with the flag, once.
 */
import { spawnSync } from 'node:child_process';

/** The environment to start again with, or null when no proxy is set or the flag is already on. */
export function proxyRelaunchEnv(env) {
  const proxy = env.HTTPS_PROXY ?? env.https_proxy;
  if (!proxy || env.NODE_USE_ENV_PROXY === '1') return null;
  return { ...env, NODE_USE_ENV_PROXY: '1' };
}

/** Runs this script again through the proxy and returns its exit code; null when not needed. */
export function relaunchThroughProxy() {
  const env = proxyRelaunchEnv(process.env);
  if (!env) return null;
  const run = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    env,
    stdio: 'inherit',
  });
  return run.status ?? 1;
}
