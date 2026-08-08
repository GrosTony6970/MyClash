import { parseArgs, request } from './edge-probe.mjs';

/**
 * Proves Traefik's plugin middlewares are BUILT AND ATTACHED, not merely
 * downloaded.
 *
 * `mc_warn_if_plugins_failed` (infra/scripts/lib/traefik-env.sh) greps the log
 * for "Plugins are disabled because an error has occurred", which Traefik only
 * logs when the GitHub *fetch* fails. A bad plugin *config* is silent: the
 * fetch succeeds, the middleware reports status=disabled, every router using it
 * fails to build and serves 404 — while `docker compose config`, `pnpm
 * infra:review` and Traefik's own --ping stay green. Not hypothetical; it is
 * what a missing geoblock `api` field did in dev on 2026-07-29.
 *
 *   node scripts/check-edge-plugins.mjs --domain myclash.fr
 *   node scripts/check-edge-plugins.mjs --mode=dev
 *   node scripts/check-edge-plugins.mjs --deep         # per-middleware status
 *
 * Default mode is credential-free by design, because the deploy scripts run it
 * unattended. --deep reads the Traefik API and diagnoses a red default run.
 */

const DASHBOARD_STATUSES = [401, 403];

/**
 * Prod probes go through 127.0.0.1:443 with the Host header and TLS SNI set to
 * the real hostname rather than resolving it: that works mid-deploy before DNS
 * propagates, does not need the VPS to hairpin its own public IP, and stays
 * honest when run from outside the GeoBlock allow-list. Both geoblock instances
 * set allowLocalRequests: true (infra/config/traefik/middlewares.yml), so a
 * loopback client is not geo-denied. Every row's chain contains at least one
 * plugin middleware, so failing to build the plugin fails the route.
 *
 * `expect: 'hsts'` — myclash-security-headers@file sits in these chains, and
 * Traefik's fallback 404 (what you get when a router does NOT build) runs no
 * middleware at all. Asserting the header rather than the status code is what
 * separates "the chain is gone" from "the backend itself answered 404".
 *
 * `expect: 'auth-challenge'` — the dashboard chain has no security-headers, so
 * it is judged on 401/403 (auth or geo denial, both proving the chain built)
 * versus 404.
 */
export const PROD_PROBES = [
  {
    host: (domain) => `traefik.${domain}`,
    path: '/dashboard/',
    middlewares: 'myclash-geoblock-admin + myclash-fail2ban-auth',
    expect: 'auth-challenge',
  },
  {
    // Stripped to GoTrue's own /health by supabase-auth-strip, not a Nest route.
    host: (domain) => `app.${domain}`,
    path: '/auth/v1/health',
    middlewares: 'myclash-geoblock-public + myclash-fail2ban-auth',
    expect: 'hsts',
  },
  {
    // /api/v1/version, NOT /api/v1/health: `health` is in
    // API_GLOBAL_PREFIX_EXCLUDE, so it answers only on the api. host that
    // Traefik routes wholesale, and 404s on the three PathPrefix(/api/v1)
    // hosts. /version was deliberately put under the prefix for this reason.
    host: (domain) => `staff.${domain}`,
    path: '/api/v1/version',
    middlewares: 'myclash-geoblock-public + myclash-fail2ban-staff',
    expect: 'hsts',
  },
  {
    // Unprefixed here on purpose — see above; api.${DOMAIN} routes wholesale.
    host: (domain) => `api.${domain}`,
    path: '/health',
    middlewares: 'myclash-geoblock-public',
    expect: 'hsts',
  },
];

/** The four instances declared across middlewares.yml and the traefik labels. */
export const EXPECTED_MIDDLEWARES = [
  'myclash-geoblock-admin@file',
  'myclash-geoblock-public@file',
  'myclash-fail2ban-auth@docker',
  'myclash-fail2ban-staff@docker',
];

const RECOVERY = [
  'Restore availability first:',
  '  TRAEFIK_PLUGINS=off ./infra/scripts/start.sh',
  'Then diagnose:',
  '  docker logs myclash-traefik | grep -i plugin',
  '  pnpm infra:plugins -- --deep',
].join('\n  ');

/**
 * TRAEFIK_PLUGINS=off empties the MW_* prefixes in traefik-env.sh, so the
 * chains legitimately carry no plugin middleware. Failing then would be
 * reporting the kill-switch as an outage — but passing silently would let a
 * stack stay unprotected without anyone noticing, so it warns instead.
 */
export function pluginsDisabled(env = process.env) {
  return (env['TRAEFIK_PLUGINS'] ?? 'on') === 'off';
}

/**
 * The verdict for one default-mode probe. Pure, so the branch a live stack
 * rarely reaches is still covered by tests.
 */
export function verdictFor(probe, response) {
  if (response.statusCode === null) {
    return {
      ok: false,
      reason: `no response (${response.error?.message ?? 'unknown error'})`,
    };
  }

  if (probe.expect === 'auth-challenge') {
    // The dashboard chain carries no security-headers, so there is no header to
    // read: 401 (basic auth) or 403 (geo denial) both prove it built, 404 is
    // Traefik's middleware-free fallback.
    return DASHBOARD_STATUSES.includes(response.statusCode)
      ? { ok: true }
      : {
          ok: false,
          reason: `expected 401 or 403 from the basic-auth chain, got ${response.statusCode}`,
        };
  }

  // The header IS the verdict, and it is checked BEFORE the status code on
  // purpose. Traefik's fallback 404 — what you get when a router fails to build
  // — runs no middleware, so it has no HSTS. A 404 that DOES carry HSTS came
  // through myclash-security-headers@file, which means the whole chain built
  // and the backend simply answered 404. Testing the status first inverts the
  // diagnosis: it reports a healthy edge with a moved route as a plugin
  // outage, and the recovery it prints (TRAEFIK_PLUGINS=off) would then detach
  // GeoBlock and Fail2Ban from a stack that never had a problem.
  const hsts = String(response.headers?.['strict-transport-security'] ?? '');
  if (hsts) return { ok: true };

  return {
    ok: false,
    reason:
      response.statusCode === 404
        ? `404 with no Strict-Transport-Security — Traefik's fallback, i.e. the router did ` +
          `not build. A middleware it references does not exist, which is what a failed or ` +
          `misconfigured plugin looks like (${probe.middlewares}).`
        : `no Strict-Transport-Security header on a ${response.statusCode} — ` +
          `myclash-security-headers@file did not run, so the router chain ` +
          `(${probe.middlewares}) did not build.`,
  };
}

/**
 * Middleware/router verdicts from the Traefik API payloads.
 *
 * Note what `status` is NOT: Traefik builds middlewares lazily, per referencing
 * router, so a middleware nothing references reports `enabled` however broken
 * its config is. Verified against v3.7.10 — a geoblock instance with its
 * mandatory `api` field deleted still listed as enabled while no router used it.
 * The reference check below is therefore load-bearing, not a nicety: without it
 * this whole mode passes on a plugin that would 404 the site the moment a route
 * picked it up, and on a chain that silently lost its ${MW_*} prefix.
 */
export function deepVerdicts(middlewares, routers) {
  const errors = [];
  const byName = new Map((middlewares ?? []).map((entry) => [entry.name, entry]));
  const referenced = new Set(
    (routers ?? []).flatMap((router) => router.middlewares ?? []).map(String),
  );

  for (const name of EXPECTED_MIDDLEWARES) {
    const entry = byName.get(name);
    if (!entry) {
      errors.push(`${name} is absent from Traefik's middleware set.`);
      continue;
    }
    if (entry.status !== 'enabled') {
      const detail = (entry.error ?? []).join('; ');
      errors.push(`${name} is ${entry.status ?? 'unknown'}${detail ? `: ${detail}` : ''}`);
      continue;
    }
    if (!referenced.has(name)) {
      errors.push(
        `${name} exists but no router references it — its config is never built, and the ` +
          'surface it should protect is unprotected.',
      );
    }
  }

  for (const router of routers ?? []) {
    if (router.status === 'enabled') continue;
    const detail = (router.error ?? []).join('; ');
    errors.push(
      `router ${router.name} is ${router.status ?? 'unknown'}${detail ? `: ${detail}` : ''}`,
    );
  }

  return errors;
}

function prodRequest(domain, hostname, path, headers) {
  return request({
    protocol: 'https:',
    host: '127.0.0.1',
    port: 443,
    servername: hostname,
    path,
    headers: { Host: hostname, ...headers },
    // Trust is pnpm infra:edge's job. Asserting it here would turn a staging
    // certificate into "no response" and hide the status code this check
    // exists to read.
    rejectUnauthorized: false,
  });
}

/**
 * Prod's Traefik API is reachable only through the basic-auth-gated dashboard
 * router. deploy.sh writes both halves of that credential into .env, so this
 * needs no operator input — but it must fail loudly rather than probe
 * anonymously and report the resulting 401 as a broken plugin.
 */
export function dashboardAuthHeader(env) {
  const password = env['TRAEFIK_DASHBOARD_PASSWORD'];
  if (!password) {
    throw new Error(
      'TRAEFIK_DASHBOARD_PASSWORD is not set. --deep reads the Traefik API through ' +
        'the dashboard router, which is basic-auth gated. Run from the deploy host ' +
        'with .env loaded, or export the value from .env.',
    );
  }
  const user = env['TRAEFIK_DASHBOARD_USER'] ?? 'admin';
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

async function readTraefikApi({ mode, domain, env }) {
  if (mode === 'dev') {
    // api.insecure: true in traefik.dev.yml, published on 8080 by
    // docker-compose.dev.yml. Dev has no plugin kill-switch on purpose.
    const fetchOne = (route) =>
      request({ protocol: 'http:', host: '127.0.0.1', port: 8080, path: route });
    return {
      middlewares: await fetchOne('/api/http/middlewares'),
      routers: await fetchOne('/api/http/routers'),
    };
  }

  // Prod publishes no 8080; api@internal is reachable only through the
  // dashboard router.
  const authorization = dashboardAuthHeader(env);
  const host = `traefik.${domain}`;
  const fetchOne = (route) => prodRequest(domain, host, route, { Authorization: authorization });
  return {
    middlewares: await fetchOne('/api/http/middlewares'),
    routers: await fetchOne('/api/http/routers'),
  };
}

function parseApiResponse(label, response) {
  if (response.statusCode === 401) {
    throw new Error(
      `${label}: Traefik answered 401. TRAEFIK_DASHBOARD_PASSWORD does not match ` +
        'TRAEFIK_DASHBOARD_AUTH — the pair has been edited apart.',
    );
  }
  if (response.statusCode === 404) {
    throw new Error(
      `${label}: Traefik answered 404. The dashboard router itself did not build, ` +
        'which is the very failure this check reports. Read the logs:\n  ' +
        RECOVERY,
    );
  }
  if (response.statusCode !== 200) {
    throw new Error(
      `${label}: expected 200, got ${response.statusCode ?? 'no response'}` +
        `${response.error ? ` (${response.error.message})` : ''}`,
    );
  }
  try {
    return JSON.parse(response.body);
  } catch {
    throw new Error(`${label}: response was not JSON.`);
  }
}

export async function checkEdgePlugins(args, env = process.env) {
  const domain = args.domain ?? 'myclash.fr';
  const mode = args.mode ?? 'prod';
  const deep = 'deep' in args && args.deep !== '0';
  const errors = [];
  const warnings = [];

  if (mode !== 'prod' && mode !== 'dev') {
    return { errors: [`Unknown --mode value "${mode}". Valid modes: prod, dev.`], warnings };
  }

  // The kill-switch detaches the plugin middlewares deliberately; asserting
  // them would report the operator's own recovery as a failure.
  if (mode === 'prod' && pluginsDisabled(env)) {
    warnings.push(
      'TRAEFIK_PLUGINS=off — GeoBlock and Fail2Ban are DETACHED, so there is nothing ' +
        'to verify. The edge is serving without country filtering or ban protection. ' +
        'Re-run without the kill-switch once the plugin problem is fixed.',
    );
    return { errors, warnings, skipped: true };
  }

  if (mode === 'prod') {
    for (const probe of PROD_PROBES) {
      const host = probe.host(domain);
      const verdict = verdictFor(probe, await prodRequest(domain, host, probe.path));
      if (!verdict.ok) {
        errors.push(`https://${host}${probe.path} — ${verdict.reason}`);
      }
    }
  }

  if (deep || mode === 'dev') {
    try {
      const raw = await readTraefikApi({ mode, domain, env });
      errors.push(
        ...deepVerdicts(
          parseApiResponse('middlewares', raw.middlewares),
          parseApiResponse('routers', raw.routers),
        ),
      );
    } catch (error) {
      errors.push(error.message);
    }
  }

  return { errors, warnings, skipped: false };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { errors, warnings, skipped } = await checkEdgePlugins(args);

  for (const warning of warnings) console.warn(`  ! ${warning}`);

  if (errors.length > 0) {
    console.error('Edge plugin review failed:');
    for (const error of errors) console.error(`  - ${error}`);
    console.error(`\n  ${RECOVERY}`);
    process.exit(1);
  }

  if (skipped) process.exit(0);

  const mode = args.mode ?? 'prod';
  console.log(
    `Edge plugin review passed (${mode}). GeoBlock and Fail2Ban middlewares are built ` +
      'and attached to their routers.',
  );
}

// Guarded so the test file can import the helpers without running a probe.
// Same pattern (and same reason) as check-complexity.mjs and deploy.ts.
const invokedDirectly = process.argv[1]?.endsWith('check-edge-plugins.mjs') ?? false;
if (invokedDirectly) {
  await main();
}
