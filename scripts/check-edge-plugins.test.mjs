import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  EXPECTED_MIDDLEWARES,
  EXPECTED_ROUTERS,
  PROD_PROBES,
  checkEdgePlugins,
  dashboardAuthHeader,
  deepVerdicts,
  effectivePriority,
  pluginsDisabled,
  routerVerdicts,
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

// The header is checked BEFORE the status code, and this is the case that
// proves why. Traefik's fallback 404 runs no middleware, so a 404 that carries
// HSTS came through myclash-security-headers@file: the chain built and the
// backend simply answered 404. Judging on the status instead would report a
// healthy edge with a moved route as a plugin outage — and the recovery it
// prints detaches GeoBlock and Fail2Ban from a stack that was never broken.
test('a 404 that carries HSTS passes — the chain built, the backend answered', () => {
  assert.equal(verdictFor(HSTS_PROBE, { statusCode: 404, headers: OK_HEADERS }).ok, true);
});

test('a 404 with no HSTS fails — that is Traefik s middleware-free fallback', () => {
  const verdict = verdictFor(HSTS_PROBE, { statusCode: 404, headers: {} });
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

// `auth-challenge` is a status-code-only verdict, and it is correct for exactly
// one row: traefik.${DOMAIN}, whose chain carries no security-headers so there
// is no header to read. Every other chain has one, and judging those on the
// status inverts the diagnosis — an admin. row shipped with this verdict and
// reported a healthy edge as a plugin outage on every deploy, because both
// geoblock instances set allowLocalRequests: true and the loopback probe can
// therefore never be geo-denied. Pinned so the next row cannot repeat it.
test('auth-challenge is used by the traefik dashboard row and nothing else', () => {
  const judgedOnStatus = PROD_PROBES.filter((probe) => probe.expect === 'auth-challenge').map(
    (probe) => `${probe.host('example.org')}${probe.path}`,
  );
  assert.deepEqual(judgedOnStatus, ['traefik.example.org/dashboard/']);
});

// The regression itself. /api/v1/staff-auth/login is POST-only, so a GET is
// always a backend 404 — the header is the only thing that separates that from
// Traefik's middleware-free fallback.
test('the admin staff-auth row passes on a 404 that carries HSTS', () => {
  const row = PROD_PROBES.find(
    (probe) =>
      probe.host('example.org') === 'admin.example.org' &&
      probe.path === '/api/v1/staff-auth/login',
  );
  assert.ok(row, 'the admin staff-auth probe row is missing');
  assert.equal(verdictFor(row, { statusCode: 404, headers: OK_HEADERS }).ok, true);
  assert.equal(verdictFor(row, { statusCode: 404, headers: {} }).ok, false);
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

/**
 * The prod router set as Traefik v3.7 actually serialises it — priorities and
 * middleware order copied from a live `/api/http/routers` read, including
 * myclash-api's 22, which is the computed rule-length default for a router
 * carrying no priority label.
 */
const CHAIN_TAIL = ['myclash-security-headers@file', 'myclash-compress@file'];
function liveRouters(patch = {}) {
  return [
    {
      name: 'myclash-api@docker',
      rule: 'Host(`api.myclash.fr`)',
      priority: 22,
      status: 'enabled',
      middlewares: ['myclash-geoblock-public@file', ...CHAIN_TAIL],
    },
    {
      name: 'myclash-public-api@docker',
      rule: 'Host(`app.myclash.fr`) && PathPrefix(`/api/v1`)',
      priority: 30,
      status: 'enabled',
      middlewares: ['myclash-geoblock-public@file', ...CHAIN_TAIL],
    },
    {
      name: 'myclash-staff-api@docker',
      rule: 'Host(`staff.myclash.fr`) && PathPrefix(`/api/v1`)',
      priority: 30,
      status: 'enabled',
      middlewares: ['myclash-geoblock-public@file', 'myclash-fail2ban-staff@docker', ...CHAIN_TAIL],
    },
    {
      name: 'myclash-admin-api@docker',
      rule: 'Host(`admin.myclash.fr`) && PathPrefix(`/api/v1`)',
      priority: 30,
      status: 'enabled',
      middlewares: ['myclash-geoblock-admin@file', ...CHAIN_TAIL],
    },
    {
      name: 'myclash-staff-auth@docker',
      rule: 'PathPrefix(`/api/v1/staff-auth`)',
      priority: 40,
      status: 'enabled',
      middlewares: ['myclash-geoblock-public@file', 'myclash-fail2ban-staff@docker', ...CHAIN_TAIL],
    },
    {
      name: 'myclash-staff-auth-admin@docker',
      rule: 'Host(`admin.myclash.fr`) && PathPrefix(`/api/v1/staff-auth`)',
      priority: 50,
      status: 'enabled',
      middlewares: ['myclash-geoblock-admin@file', 'myclash-fail2ban-staff@docker', ...CHAIN_TAIL],
    },
  ]
    .map((router) => ({ ...router, ...(patch[router.name] ?? {}) }))
    .filter((router) => !patch.absent?.includes(router.name));
}

test('the live prod router set satisfies EXPECTED_ROUTERS', () => {
  assert.deepEqual(routerVerdicts(liveRouters(), EXPECTED_ROUTERS.prod), []);
});

// Traefik computes a missing priority as the rule's length, and v3.7 serialises
// that computed value. Reading it as 0 would make every comparison against an
// unlabelled router pass or fail by accident, so the fallback mirrors Traefik's
// own formula rather than guessing.
test('effectivePriority prefers the declared value and falls back to rule length', () => {
  assert.equal(effectivePriority({ priority: 40, rule: 'PathPrefix(`/x`)' }), 40);
  assert.equal(effectivePriority({ rule: 'Host(`api.myclash.fr`)' }), 22);
  assert.equal(effectivePriority({ priority: 0, rule: 'Host(`api.myclash.fr`)' }), 22);
  assert.equal(effectivePriority(undefined), 0);
});

// The failure the default probes are blind to: with the jail router gone, every
// request falls through to myclash-api, which answers 404-with-HSTS exactly as
// the jailed router did.
test('an absent expected router is an error, not a skip', () => {
  const errors = routerVerdicts(
    liveRouters({ absent: ['myclash-staff-auth@docker'] }),
    EXPECTED_ROUTERS.prod,
  );
  assert.ok(errors.some((e) => /router myclash-staff-auth@docker is absent/.test(e)));
});

test('an expected router that failed to build is reported with its plugin error', () => {
  const errors = routerVerdicts(
    liveRouters({
      'myclash-staff-auth@docker': {
        status: 'disabled',
        error: ['middleware "myclash-fail2ban-staff@docker" does not exist'],
      },
    }),
    EXPECTED_ROUTERS.prod,
  );
  assert.ok(
    errors.some((e) => /router myclash-staff-auth@docker is disabled: middleware/.test(e)),
    errors.join('\n'),
  );
});

// A router that builds without its jail is the original hole wearing the new
// router's name: the path answers, and nothing counts the failed PIN attempts.
test('an expected router missing its jail middleware fails', () => {
  const errors = routerVerdicts(
    liveRouters({
      'myclash-staff-auth@docker': {
        middlewares: ['myclash-geoblock-public@file', ...CHAIN_TAIL],
      },
    }),
    EXPECTED_ROUTERS.prod,
  );
  assert.deepEqual(errors, [
    'router myclash-staff-auth@docker does not chain myclash-fail2ban-staff@docker.',
  ]);
});

// The admin twin exists only to keep that path on the admin allow-list. Chained
// with the public geoblock it still answers, still bans, and has silently
// widened the country filter — invisible to any probe that reads status codes.
test('an expected router on the wrong geoblock instance fails', () => {
  const errors = routerVerdicts(
    liveRouters({
      'myclash-staff-auth-admin@docker': {
        middlewares: [
          'myclash-geoblock-public@file',
          'myclash-fail2ban-staff@docker',
          ...CHAIN_TAIL,
        ],
      },
    }),
    EXPECTED_ROUTERS.prod,
  );
  assert.deepEqual(errors, [
    'router myclash-staff-auth-admin@docker does not chain myclash-geoblock-admin@file.',
  ]);
});

// Existing and enabled is not the same as winning. A jail router that loses the
// match protects nothing, and the design rests on 50 > 40 > 30 > 22.
test('an expected router that loses the priority match fails', () => {
  const errors = routerVerdicts(
    liveRouters({ 'myclash-staff-auth@docker': { priority: 20 } }),
    EXPECTED_ROUTERS.prod,
  );
  assert.ok(
    errors.some((e) =>
      /myclash-staff-auth@docker \(priority 20\) does not outrank myclash-api@docker \(priority 22\)/.test(
        e,
      ),
    ),
    errors.join('\n'),
  );
});

// Renaming the rival would otherwise delete the comparison silently and leave
// this table green forever — the same rot EXPECTED_MIDDLEWARES guards against.
test('an absent outranks target is an error, so the table cannot rot green', () => {
  const errors = routerVerdicts(
    liveRouters({ absent: ['myclash-public-api@docker'] }),
    EXPECTED_ROUTERS.prod,
  );
  assert.deepEqual(errors, [
    'router myclash-public-api@docker is absent, so myclash-staff-auth@docker cannot be proven ' +
      'to outrank it — the expectation was written against a router that no longer exists.',
  ]);
});

// One fault, one line: the generic router sweep and the named-router pass both
// report a build failure, in the same words.
test('deep mode does not print a failed expected router twice', () => {
  const errors = deepVerdicts(
    enabledMiddlewares(),
    [...routersUsingAll(), ...liveRouters({ 'myclash-staff-auth@docker': { status: 'disabled' } })],
    EXPECTED_ROUTERS.prod,
  );
  assert.deepEqual(errors, ['router myclash-staff-auth@docker is disabled']);
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

// TRAEFIK_DASHBOARD_AUTH is the credential Traefik checks, so its user half is
// the truth. Defaulting blind to `admin` turns an operator who renamed it into
// a 401 on every deploy. The `$$` Compose escaping is confined to the hash.
test('the dashboard user comes from TRAEFIK_DASHBOARD_AUTH when not set explicitly', () => {
  assert.equal(
    dashboardAuthHeader({
      TRAEFIK_DASHBOARD_PASSWORD: 'pw',
      TRAEFIK_DASHBOARD_AUTH: 'ops:$$2y$$05$$hash',
    }),
    `Basic ${Buffer.from('ops:pw').toString('base64')}`,
  );
  assert.equal(
    dashboardAuthHeader({ TRAEFIK_DASHBOARD_PASSWORD: 'pw', TRAEFIK_DASHBOARD_AUTH: '' }),
    `Basic ${Buffer.from('admin:pw').toString('base64')}`,
  );
});

test('an unknown --mode fails instead of falling back to prod', async () => {
  const result = await checkEdgePlugins({ mode: 'staging' }, {});
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Unknown --mode/);
});

// A probe aimed at a route the API does not serve is the worst failure this
// script has: it reports a healthy edge as a plugin outage on every single
// deploy, and the recovery it prints detaches GeoBlock and Fail2Ban. It shipped
// once — /api/v1/health, which does not exist because `health` is in
// API_GLOBAL_PREFIX_EXCLUDE and so answers only on the api. host that Traefik
// routes wholesale.
//
// Anchored on the COMMITTED client, not on openapi.json. That file is
// gitignored and emitted on demand, so reading it made this test pass on any
// machine that had run `pnpm openapi:emit` and fail with ENOENT everywhere
// else — CI included, where it took the whole `test:scripts` step (and the Lint
// job with it) red from the day it was added. schema.ts is generated from the
// same document and `pnpm quality:openapi-drift` fails if the two differ, so
// the guarantee is identical and needs no build to check.
const SCHEMA_PATH = path.join(
  import.meta.dirname,
  '..',
  'packages/api-client/src/generated/schema.ts',
);

/** Route keys of openapi-typescript's `paths` interface, e.g. `  '/health': {`. */
function servedPaths(source) {
  const start = source.indexOf('export interface paths {');
  assert.ok(start !== -1, 'generated client has no `paths` interface');
  const rest = source.slice(start + 1);
  const end = rest.indexOf('\nexport ');
  const block = end === -1 ? rest : rest.slice(0, end);
  // Quote style follows the repo's prettier config — accept either.
  return new Set([...block.matchAll(/^ {2}['"](\/[^'"]*)['"]:/gmu)].map((m) => m[1]));
}

test('every Nest-served probe path exists in the emitted OpenAPI spec', () => {
  const served = servedPaths(readFileSync(SCHEMA_PATH, 'utf8'));
  assert.ok(served.size > 50, `expected the full route list, parsed ${served.size}`);

  // Only rows that reach Nest. /dashboard/ is Traefik's own api@internal and
  // /auth/v1/* is stripped to GoTrue, so neither appears in this spec.
  const nestPaths = PROD_PROBES.map((p) => p.path).filter(
    (p) => p === '/health' || p.startsWith('/api/v1/'),
  );
  assert.ok(nestPaths.length >= 2, 'expected at least the api and scoring rows');
  for (const probePath of nestPaths) {
    assert.ok(served.has(probePath), `probe path ${probePath} is not a route the API serves`);
  }
});

test('parses inline and spaced flags without swallowing the next flag', () => {
  assert.deepEqual(parseArgs(['--mode=dev', '--deep', '--domain', 'example.org']), {
    mode: 'dev',
    deep: '',
    domain: 'example.org',
  });
});
