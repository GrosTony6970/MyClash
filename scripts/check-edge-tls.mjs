import tls from 'node:tls';

import { parseArgs, request } from './edge-probe.mjs';

const args = parseArgs(process.argv.slice(2));
const domain = args.domain ?? 'myclash.fr';
const minCertDays = Number(args['min-cert-days'] ?? 21);

// Keyed by the label you pass to --hosts; `apex` is the bare domain.
const HOSTS_BY_KEY = {
  apex: domain,
  www: `www.${domain}`,
  api: `api.${domain}`,
  app: `app.${domain}`,
  admin: `admin.${domain}`,
  scoring: `scoring.${domain}`,
};

/**
 * `--hosts=app,api` narrows the run. Default is every host.
 *
 * This exists so the check can run from CI at all. `admin.${domain}` sits behind
 * myclash-geoblock-admin — an allow-list over [FR,BE,LU,CH,DE,IT,ES,GB,NL,AT]
 * that fails CLOSED — and geoblock runs BEFORE myclash-security-headers, so a
 * runner outside those countries gets a 403 with no HSTS header and this script
 * reports an edge failure that is really a geo denial. `app.${domain}` uses the
 * public block-list ([CN,RU,KP,IR,BY], fails OPEN) and answers anyone, which is
 * why the nightly job asks for that host only.
 */
const hostKeys = args.hosts
  ? String(args.hosts)
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean)
  : Object.keys(HOSTS_BY_KEY);

const unknownKeys = hostKeys.filter((key) => !(key in HOSTS_BY_KEY));
if (unknownKeys.length > 0) {
  console.error(
    `Unknown --hosts value(s): ${unknownKeys.join(', ')}. ` +
      `Valid keys: ${Object.keys(HOSTS_BY_KEY).join(', ')}.`,
  );
  process.exit(1);
}

const hosts = hostKeys.map((key) => HOSTS_BY_KEY[key]);
const checkedKeys = new Set(hostKeys);

/**
 * `--allow-staging-cert` downgrades "this host serves an untrusted LE STAGING
 * certificate" from a failure to a warning. Set it while prod is deliberately
 * on `deploy.sh --dev-certs`; drop it the day real certificates are issued.
 * Every other assertion still fails hard, and the staging cert is always
 * reported either way.
 */
const allowStagingCert = 'allow-staging-cert' in args && args['allow-staging-cert'] !== '0';

const errors = [];
const warnings = [];

for (const host of hosts) {
  const redirect = await request({
    protocol: 'http:',
    host,
    path: '/',
    method: 'GET',
    timeoutMs: 10_000,
  });
  if (![301, 302, 307, 308].includes(redirect.statusCode ?? 0)) {
    errors.push(
      `http://${host}/ did not redirect to HTTPS; status=${redirect.statusCode ?? 'none'}`,
    );
  } else if (!String(redirect.headers.location ?? '').startsWith(`https://${host}`)) {
    errors.push(
      `http://${host}/ redirected to unexpected location: ${redirect.headers.location ?? 'none'}`,
    );
  }

  // rejectUnauthorized:false so an untrusted chain does not mask every OTHER
  // assertion on this host. Trust is not waived — it is asserted explicitly
  // below, where the failure can name the issuer instead of being an opaque
  // "unable to get local issuer certificate" on the HSTS check.
  const httpsResult = await request({
    protocol: 'https:',
    host,
    path: '/',
    method: 'GET',
    timeoutMs: 10_000,
    rejectUnauthorized: false,
  });
  const hsts = String(httpsResult.headers['strict-transport-security'] ?? '');
  if (!/max-age=31536000/i.test(hsts) || !/includeSubDomains/i.test(hsts)) {
    errors.push(`https://${host}/ missing expected HSTS header; got "${hsts || 'none'}"`);
  }

  try {
    const { cert, authorized, authorizationError } = await certificate(host);
    const validTo = Date.parse(cert.valid_to);
    const daysLeft = Math.floor((validTo - Date.now()) / 86_400_000);
    if (!Number.isFinite(validTo) || daysLeft < minCertDays) {
      errors.push(`https://${host}/ certificate expires too soon: ${cert.valid_to}`);
    }
    if (!authorized) {
      const issuer = cert.issuer?.CN ?? 'unknown issuer';
      if (isStagingIssuer(cert)) {
        // deploy.sh --dev-certs points ACME at the LE staging CA, whose roots no
        // client trusts: every visitor gets a browser warning, and — less
        // obviously — every realtime websocket dies, because a click-through
        // exception covers page navigation but not the WS handshake. Tolerated
        // only when the operator has said so, and never silently.
        const message =
          `https://${host}/ is serving a Let's Encrypt STAGING certificate ` +
          `("${issuer}") — no browser trusts it, and realtime websockets cannot ` +
          `connect at all. Redeploy without --dev-certs, or install the staging ` +
          `root on each device that needs live data: node scripts/trust-staging-ca.mjs`;
        if (allowStagingCert) warnings.push(message);
        else errors.push(message);
      } else {
        errors.push(
          `https://${host}/ certificate is not trusted: ${authorizationError} (issuer "${issuer}")`,
        );
      }
    }
  } catch (error) {
    errors.push(`https://${host}/ certificate check failed: ${error.message}`);
  }
}

if (checkedKeys.has('api')) {
  const health = await request({
    protocol: 'https:',
    host: `api.${domain}`,
    path: '/health',
    method: 'GET',
    timeoutMs: 10_000,
    // Per-host trust is asserted in the loop above; an untrusted chain here
    // would report as "no response" and hide the status code we came for.
    rejectUnauthorized: false,
  });
  if (health.statusCode !== 200) {
    errors.push(`https://api.${domain}/health returned ${health.statusCode ?? 'no response'}`);
  }
}

// Realtime, reachable AS app.${domain} — not merely up.
//
// supabase/realtime is multi-tenant and resolves the tenant from the first
// label of the Host header. Traefik forwards the client's Host untouched, so
// this only works while SELF_HOST_TENANT_NAME matches that label. When it did
// not, every websocket handshake 403'd and every live public surface silently
// fell back to polling — for months. Nothing caught it: the container's own
// healthcheck addresses the tenant by PATH (/api/tenants/:id/health) and
// answered 200 throughout.
//
// /api/ping is the cheapest route that resolves the tenant the way the socket
// does. A misconfigured tenant answers 401 {"message":"Tenant not found in
// database"}; a wrong/missing key answers 403.
const realtimeKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!checkedKeys.has('app')) {
  // --hosts excluded it; saying nothing here would be indistinguishable from a pass.
  console.warn(`app.${domain} not in --hosts — skipped the realtime tenant-resolution probe.`);
} else if (realtimeKey) {
  const ping = await request({
    protocol: 'https:',
    host: `app.${domain}`,
    path: '/realtime/v1/api/ping',
    method: 'GET',
    headers: { Authorization: `Bearer ${realtimeKey}` },
    timeoutMs: 10_000,
    rejectUnauthorized: false, // see the health probe above
  });
  if (ping.statusCode !== 200) {
    errors.push(
      `https://app.${domain}/realtime/v1/api/ping returned ${ping.statusCode ?? 'no response'} ` +
        `(expected 200). 401 = realtime cannot resolve a tenant named "app" — check ` +
        `SELF_HOST_TENANT_NAME against the Host Traefik forwards; websockets are dead.`,
    );
  }
} else {
  console.warn(
    'SUPABASE_ANON_KEY not set — skipped the realtime tenant-resolution probe on ' +
      `app.${domain}. This is the check that catches a dead websocket.`,
  );
}

for (const warning of warnings) console.warn(`  ! ${warning}`);

if (errors.length > 0) {
  console.error(`Edge/TLS review failed for ${domain}:`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `Edge/TLS review passed for ${domain}. Checked ${hosts.length} host(s): ${hostKeys.join(', ')}.`,
);

/** True when the chain was issued by Let's Encrypt's STAGING CA, whose roots
 *  ship in no trust store. Their issuer CN is prefixed "(STAGING) ". */
function isStagingIssuer(cert) {
  return /\(STAGING\)/i.test(String(cert?.issuer?.CN ?? ''));
}

/** Connects without rejecting, and returns the chain plus the verdict, so the
 *  caller can tell "untrusted because staging" from "untrusted, full stop". */
function certificate(host) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host,
        port: 443,
        servername: host,
        rejectUnauthorized: false,
        timeout: 10_000,
      },
      () => {
        const cert = socket.getPeerCertificate();
        const { authorized, authorizationError } = socket;
        socket.end();
        resolve({ cert, authorized, authorizationError });
      },
    );
    socket.on('error', reject);
    socket.on('timeout', () => {
      socket.destroy(new Error('timeout'));
    });
  });
}
