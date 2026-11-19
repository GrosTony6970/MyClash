/**
 * A child process environment with no proxy of the developer's or the CI's own, plus `extra`.
 * The ops skill's command-line tests (`scripts/ops-skill*.test.mjs`) set their own proxy, or
 * none, and must not inherit one.
 */
export function noProxyEnv(extra) {
  const env = { ...process.env, ...extra };
  for (const name of ['HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy', 'NODE_USE_ENV_PROXY']) {
    if (!(name in extra)) delete env[name];
  }
  return env;
}
