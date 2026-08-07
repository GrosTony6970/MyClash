import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXPECTED_MIDDLEWARES,
  checkEdgePlugins,
  dashboardAuthHeader,
  deepVerdicts,
  pluginsDisabled,
  verdictFor,
} from './check-edge-plugins.mjs';
import { parseArgs } from './edge-probe.mjs';

/**
 * The probe's whole value is in the branches a healthy stack never reaches, so
 * these cover the verdicts rather than the network. Every case below is a
 * failure mode that once passed a green check: a 404 that looks like a backend
 * 404, a plugin that downloaded fine and then refused to configure, and the
 * kill-switch being mistaken for an outage.
 */

const HSTS_PROBE = { expect: 'hsts', middlewares: 'myclash-geoblock-public' };
const DASHBOARD_PROBE = { expect: 'auth-challenge', middlewares: 'myclash-geoblock-admin' };

const OK_HEADERS = { 'strict-transport-security': 'max-age=31536000; includeSubDomains' };

test('a chain that built carries the security-headers output', () => {
  assert.equal(verdictFor(HSTS_PROBE, { statusCode: 200, headers: OK_HEADERS }).ok, true);
});

test('404 fails even before the header check, and says why', () => {
  const verdict = verdictFor(HSTS_PROBE, { statusCode: 404, headers: OK_HEADERS });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /router did not build/);
});

// Traefik's fallback 404 runs no middleware, so a 200 without HSTS cannot come
// from a chain that includes myclash-security-headers@file. This is the case a
// status-code-only check reports as healthy.
test('a 2xx with no HSTS still fails — the chain never ran', () => {
  const verdict = verdictFor(HSTS_PROBE, { statusCode: 200, headers: {} });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /did not build/);
});

test('no response is a failure, not a pass', () => {
  const verdict = verdictFor(HSTS_PROBE, {
    statusCode: null,
    headers: {},
    error: new Error('timeout'),
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /timeout/);
});

// The dashboard chain has no security-headers, so it is judged on the auth
// challenge instead. 403 counts: GeoBlock denying the client still proves the
// plugin middleware built.
test('the dashboard passes on 401 and on 403, fails on 404 and 200', () => {
  assert.equal(verdictFor(DASHBOARD_PROBE, { statusCode: 401, headers: {} }).ok, true);
  assert.equal(verdictFor(DASHBOARD_PROBE, { statusCode: 403, headers: {} }).ok, true);
  assert.equal(verdictFor(DASHBOARD_PROBE, { statusCode: 404, headers: {} }).ok, false);
  assert.equal(verdictFor(DASHBOARD_PROBE, { statusCode: 200, headers: {} }).ok, false);
});

function enabledMiddlewares() {
  return EXPECTED_MIDDLEWARES.map((name) => ({ name, status: 'enabled', error: [] }));
}

/** One router referencing all four, so the reference check is satisfied. */
function routersUsingAll() {
  return [{ name: 'myclash-api@docker', status: 'enabled', middlewares: EXPECTED_MIDDLEWARES }];
}

test('deep mode passes when all four middlewares and every router are enabled', () => {
  const errors = deepVerdicts(enabledMiddlewares(), routersUsingAll());
  assert.deepEqual(errors, []);
});

// Traefik builds middlewares lazily, per referencing router: one that nothing
// uses reports `enabled` however broken its config is (verified against v3.7.10
// with geoblock's mandatory `api` field deleted). Trusting `status` alone would
// pass a plugin that 404s the site the moment a route picks it up — and would
// pass a chain that lost its ${MW_*} prefix, i.e. an unprotected edge.
test('deep mode fails an enabled middleware that no router references', () => {
  const errors = deepVerdicts(enabledMiddlewares(), [
    {
      name: 'myclash-api@docker',
      status: 'enabled',
      middlewares: EXPECTED_MIDDLEWARES.filter((n) => n !== 'myclash-geoblock-admin@file'),
    },
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /myclash-geoblock-admin@file exists but no router references it/);
});

// The 2026-07-29 dev incident: geoblock fetched fine, then rejected its own
// config. The log grep saw nothing.
test('deep mode reports a disabled middleware with the plugin error text', () => {
  const middlewares = enabledMiddlewares();
  middlewares[0] = {
    name: 'myclash-geoblock-admin@file',
    status: 'disabled',
    error: ['no api uri given'],
  };
  const errors = deepVerdicts(middlewares, routersUsingAll());
  assert.equal(errors.length, 1);
  assert.match(errors[0], /myclash-geoblock-admin@file is disabled: no api uri given/);
});

test('deep mode reports a middleware that is absent entirely', () => {
  const errors = deepVerdicts(
    enabledMiddlewares().filter((m) => m.name !== 'myclash-fail2ban-staff@docker'),
    routersUsingAll(),
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /myclash-fail2ban-staff@docker is absent/);
});

test('deep mode reports routers that failed to build', () => {
  const errors = deepVerdicts(enabledMiddlewares(), [
    ...routersUsingAll(),
    {
      name: 'myclash-auth@docker',
      status: 'disabled',
      error: ['middleware "myclash-geoblock-public@file" does not exist'],
    },
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /router myclash-auth@docker is disabled: middleware/);
});

test('reads the TRAEFIK_PLUGINS kill-switch, defaulting to on', () => {
  assert.equal(pluginsDisabled({}), false);
  assert.equal(pluginsDisabled({ TRAEFIK_PLUGINS: 'on' }), false);
  assert.equal(pluginsDisabled({ TRAEFIK_PLUGINS: 'off' }), true);
});

// Deliberate detachment is not an outage — but it must not look like a pass
// either, or a stack left unprotected reports green forever.
test('kill-switch skips the probes and warns instead of failing', async () => {
  const result = await checkEdgePlugins({ domain: 'example.org' }, { TRAEFIK_PLUGINS: 'off' });
  assert.deepEqual(result.errors, []);
  assert.equal(result.skipped, true);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /DETACHED/);
});

// Probing anonymously would get a 401 and report it as a broken plugin, so a
// missing credential has to be its own error.
test('deep mode against prod refuses to run without the dashboard password', () => {
  assert.throws(() => dashboardAuthHeader({}), /TRAEFIK_DASHBOARD_PASSWORD is not set/);
  assert.equal(
    dashboardAuthHeader({ TRAEFIK_DASHBOARD_PASSWORD: 'pw' }),
    `Basic ${Buffer.from('admin:pw').toString('base64')}`,
  );
  assert.equal(
    dashboardAuthHeader({ TRAEFIK_DASHBOARD_PASSWORD: 'pw', TRAEFIK_DASHBOARD_USER: 'ops' }),
    `Basic ${Buffer.from('ops:pw').toString('base64')}`,
  );
});

test('an unknown --mode fails instead of falling back to prod', async () => {
  const result = await checkEdgePlugins({ mode: 'staging' }, {});
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Unknown --mode/);
});

test('parses inline and spaced flags without swallowing the next flag', () => {
  assert.deepEqual(parseArgs(['--mode=dev', '--deep', '--domain', 'example.org']), {
    mode: 'dev',
    deep: '',
    domain: 'example.org',
  });
});
