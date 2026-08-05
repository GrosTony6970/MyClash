/**
 * Install Let's Encrypt's STAGING root into the Windows trust store, so a
 * machine can use MyClash while prod is deployed with `deploy.sh --dev-certs`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RUN THIS ON THE VIEWING DEVICE (the laptop / display PC / projector box).
 * NOT on the VPS. It changes the local certificate store, nothing remote.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHY IT IS NEEDED
 *
 * `--dev-certs` points ACME at the Let's Encrypt staging CA, whose roots ship in
 * no trust store. A browser lets you click through the interstitial for page
 * NAVIGATION, so the app appears to work — but it does not extend that exception
 * to the WebSocket handshake. supabase-js therefore reports CHANNEL_ERROR and
 * every realtime surface sits on "Reconnecting…" forever. Trusting the root is
 * what makes the websocket connect; there is no per-page way around it.
 *
 * WHAT GETS INSTALLED
 *
 * One certificate: "(STAGING) Pretend Pear X1", self-signed, 2015 → 2035. Both
 * intermediates in use ("Ersatz Emmer YR2" on the app/api hosts, "Dastardly
 * Durum YR1" on the apex) chain to it via the cross-signed "Yonder Yam Root YR",
 * which Traefik ships in the handshake — so this single anchor verifies every
 * MyClash host.
 *
 * It is a fixed Let's Encrypt trust anchor, NOT a per-deploy artifact. Leaf
 * certs live in `data/traefik/acme-staging.json` on the VPS and renew inside
 * Traefik's ~30-day window. So this is a ONE-TIME action per device: it survives
 * every future `--dev-certs` redeploy, every renewal, and any new hostname.
 *
 * SECURITY
 *
 * The staging CA still performs domain-control validation, but its hierarchy is
 * unaudited and not CT-logged, and Let's Encrypt explicitly says not to trust
 * it. Installing this root means the machine accepts ANY staging-issued
 * certificate for ANY hostname. That is an acceptable trade on operator and
 * venue devices; it is not something to put on a personal daily driver. Run with
 * `--remove` the day real certificates are issued.
 *
 * USAGE
 *
 *   node scripts/trust-staging-ca.mjs                 # install (needs elevation)
 *   node scripts/trust-staging-ca.mjs --current-user  # install, no elevation
 *   node scripts/trust-staging-ca.mjs --check         # report only, change nothing
 *   node scripts/trust-staging-ca.mjs --remove        # uninstall
 *
 *   --domain=myclash.fr        host to verify against (default myclash.fr)
 *   --anon-key=<jwt>           also prove a real websocket upgrade
 *
 * The post-install probes run with certificate validation ON, which is the whole
 * point: they fail exactly the way the browser was failing. `--anon-key` is
 * optional and never stored here — the key is public (it ships in the client
 * bundle), but a deployment's key does not belong in the repo.
 *
 * ELEVATION, AND THE DIALOG
 *
 * Writing to the Root store is the one thing Windows will not let a script do
 * quietly on a user's behalf:
 *
 *   - Default (LocalMachine) needs an Administrator terminal, and then runs with
 *     NO prompt. This is the mode to use when provisioning a display PC or
 *     scripting a fleet — it completes unattended.
 *   - `--current-user` needs no elevation, but Windows raises a modal "Do you
 *     want to install this certificate?" dialog that a human must accept. The
 *     script blocks until someone clicks it, so it cannot run unattended.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import https from 'node:https';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Node ships its OWN CA bundle and ignores the Windows trust store unless it is
 * started with `--use-system-ca`, which is a startup flag and cannot be turned
 * on at runtime. Without this re-exec the probes below fail with
 * UNABLE_TO_GET_ISSUER_CERT_LOCALLY even when the root IS installed and the
 * browser is perfectly happy — a false negative that reads exactly like the bug
 * this script exists to fix. The browsers we care about read the OS store, so
 * the OS store is what the probes have to measure.
 */
if (!process.execArgv.includes('--use-system-ca')) {
  if (!process.allowedNodeEnvironmentFlags.has('--use-system-ca')) {
    console.error(
      `This Node (${process.version}) has no --use-system-ca, so the post-install ` +
        `probes cannot read the Windows trust store. Upgrade Node, or verify by ` +
        `hand in the browser after installing.`,
    );
    process.exit(1);
  }
  const relaunch = spawnSync(
    process.execPath,
    ['--use-system-ca', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(relaunch.status ?? 1);
}

const ROOT_URL = 'https://letsencrypt.org/certs/staging/letsencrypt-stg-root-x1.pem';

/** SHA-256 over the DER encoding. A downloaded root is installed ONLY when it
 *  matches — an unverified trust anchor is worse than no trust anchor. */
const ROOT_SHA256 = 'E70570A989F8565AABDF7CAE27ABD1621872D6A3F811E3FEF27E3DBA02912198';

/** SHA-1, i.e. the Windows "thumbprint" certutil keys its store lookups on. */
const ROOT_THUMBPRINT = '66493BA4F36D1731729B1118C7F5E2D540E3F37B';

const ROOT_CN = '(STAGING) Pretend Pear X1';

const args = parseArgs(process.argv.slice(2));
const domain = args.domain ?? 'myclash.fr';
const appHost = `app.${domain}`;
const currentUser = has(args, 'current-user');
const scope = currentUser ? 'CurrentUser' : 'LocalMachine';

if (process.platform !== 'win32') {
  console.error(
    `This script installs into the Windows certificate store and only runs on Windows ` +
      `(detected "${process.platform}"). On macOS import the root via Keychain Access → ` +
      `System → Always Trust; on Linux drop it in /usr/local/share/ca-certificates and run ` +
      `update-ca-certificates. Firefox keeps its own store on every platform.`,
  );
  process.exit(1);
}

if (has(args, 'remove')) {
  await remove();
} else if (has(args, 'check')) {
  await check();
} else {
  await install();
}

// ── Commands ────────────────────────────────────────────────────────────────

async function install() {
  if (isInstalled()) {
    console.log(`Already trusted: "${ROOT_CN}" is in the ${scope} Root store.`);
  } else {
    const pem = await download();
    const dir = mkdtempSync(join(tmpdir(), 'myclash-ca-'));
    const file = join(dir, 'letsencrypt-stg-root-x1.crt');
    try {
      writeFileSync(file, pem);
      if (currentUser) {
        // Windows refuses to add a root to a user's store silently. Say so
        // before blocking, or this looks like a hang.
        console.log(
          `Windows will now raise a "Do you want to install this certificate?" ` +
            `dialog — accept it to continue. (Waiting…)\n` +
            `Thumbprint to expect: ${ROOT_THUMBPRINT}`,
        );
      }
      certutil(['-addstore', '-f', 'Root', file]);
      console.log(`Installed "${ROOT_CN}" into the ${scope} Root store.`);
    } catch (error) {
      if (!currentUser && /denied|0x80070005/i.test(String(error.message))) {
        console.error(
          `Access denied writing to the LocalMachine store. Either re-run this ` +
            `terminal as Administrator (no prompt, works unattended), or install ` +
            `for your own account only — which raises a trust dialog you must ` +
            `accept by hand:\n\n` +
            `  node scripts/trust-staging-ca.mjs --current-user\n`,
        );
        process.exit(1);
      }
      throw error;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const ok = await verify();
  if (!ok) process.exit(1);
  console.log(
    `\nDone. Restart the browser so it re-reads the trust store, then reload ` +
      `https://${appHost}/ — the interstitial and the "Reconnecting…" banner should both be gone.`,
  );
}

async function remove() {
  if (!isInstalled()) {
    console.log(`Nothing to do: "${ROOT_CN}" is not in the ${scope} Root store.`);
    return;
  }
  certutil(['-delstore', 'Root', ROOT_THUMBPRINT]);
  console.log(
    `Removed "${ROOT_CN}" from the ${scope} Root store. ` +
      `Restart the browser for it to take effect.`,
  );
}

async function check() {
  // Report BOTH stores, not just the selected one. Browsers read CurrentUser and
  // LocalMachine alike, so "not in LocalMachine" on its own is a misleading
  // answer to "is this machine trusting the root?".
  const stores = [
    ['LocalMachine', inStore(false)],
    ['CurrentUser', inStore(true)],
  ].filter(([, present]) => present);

  console.log(
    stores.length > 0
      ? `"${ROOT_CN}" IS present in: ${stores.map(([name]) => name).join(', ')}.`
      : `"${ROOT_CN}" is in NEITHER the LocalMachine nor the CurrentUser Root store.`,
  );
  const ok = await verify();
  if (!ok) process.exit(1);
}

// ── Verification ────────────────────────────────────────────────────────────

/**
 * Every probe runs with `rejectUnauthorized: true`. That is deliberate: an
 * untrusted chain must fail here the same way it fails in the browser, so a
 * "pass" means something.
 */
async function verify() {
  console.log(`\nVerifying against https://${appHost}/ with certificate validation ON:`);
  const results = [];

  results.push(await probe('HTTPS  ', `/api/v1/public/feature-flags`, (status) => status === 200));

  // Same origin and same TLS the websocket uses, and needs no key — a trusted
  // chain here is a trusted chain for the wss:// handshake.
  results.push(await probe('Realtime', `/realtime/v1/api/ping`, (status) => status === 200));

  if (args['anon-key']) {
    results.push(await probeWebsocket(args['anon-key']));
  }

  const ok = results.every(Boolean);
  if (!ok) {
    console.error(
      `\nAt least one probe failed. If the failure is a certificate error, the root ` +
        `is not being picked up — check you installed into the store the browser reads ` +
        `(try --current-user), or that the host really is on staging certs:\n\n` +
        `  node scripts/check-edge-tls.mjs --hosts=app --allow-staging-cert\n`,
    );
  }
  return ok;
}

function probe(label, path, accept) {
  return new Promise((resolve) => {
    const req = https.request(
      { host: appHost, path, method: 'GET', timeout: 15_000, rejectUnauthorized: true },
      (res) => {
        res.resume();
        const ok = accept(res.statusCode);
        console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}  ${path} → ${res.statusCode}`);
        resolve(ok);
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (error) => {
      console.log(`  FAIL  ${label}  ${path} → ${error.code ?? ''} ${error.message}`);
      resolve(false);
    });
    req.end();
  });
}

/** Opt-in: a real Upgrade handshake, i.e. the exact request supabase-js makes. */
function probeWebsocket(anonKey) {
  const path = `/realtime/v1/websocket?apikey=${encodeURIComponent(anonKey)}&eventsPerSecond=10&vsn=2.0.0`;
  return new Promise((resolve) => {
    const req = https.request({
      host: appHost,
      path,
      method: 'GET',
      timeout: 15_000,
      rejectUnauthorized: true,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
      },
    });
    req.on('upgrade', (res) => {
      const ok = res.statusCode === 101;
      console.log(`  ${ok ? 'ok  ' : 'FAIL'}  WSS     upgrade → ${res.statusCode}`);
      req.destroy();
      resolve(ok);
    });
    req.on('response', (res) => {
      res.resume();
      console.log(`  FAIL  WSS     upgrade refused → ${res.statusCode} (expected 101)`);
      resolve(false);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (error) => {
      console.log(`  FAIL  WSS     ${error.code ?? ''} ${error.message}`);
      resolve(false);
    });
    req.end();
  });
}

// ── Plumbing ────────────────────────────────────────────────────────────────

function download() {
  return new Promise((resolve, reject) => {
    https
      .get(ROOT_URL, { timeout: 20_000 }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`${ROOT_URL} returned ${res.statusCode}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          const actual = fingerprint(body);
          if (actual !== ROOT_SHA256) {
            reject(
              new Error(
                `Refusing to install: downloaded root does not match the pinned ` +
                  `SHA-256.\n  expected ${ROOT_SHA256}\n  got      ${actual}\n` +
                  `Either Let's Encrypt re-rooted its staging hierarchy (re-pin after ` +
                  `checking https://letsencrypt.org/docs/staging-environment/), or the ` +
                  `download was tampered with.`,
              ),
            );
            return;
          }
          resolve(body);
        });
      })
      .on('error', reject);
  });
}

/** SHA-256 over the DER bytes, matching `openssl x509 -fingerprint -sha256`. */
function fingerprint(pem) {
  const base64 = pem.replace(/-----[^-]*-----/g, '').replace(/\s+/g, '');
  return createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex').toUpperCase();
}

function isInstalled() {
  return inStore(currentUser);
}

/** Is the pinned root in the per-user (`user: true`) or machine Root store? */
function inStore(user) {
  try {
    certutilIn(user, ['-store', 'Root', ROOT_THUMBPRINT]);
    return true;
  } catch {
    return false;
  }
}

function certutil(argv) {
  return certutilIn(currentUser, argv);
}

/** `-user` selects the per-account store, which needs no elevation. */
function certutilIn(user, argv) {
  return execFileSync('certutil', user ? ['-user', ...argv] : argv, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function has(parsed, key) {
  return key in parsed && parsed[key] !== '0';
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (!arg.startsWith('--')) continue;
    const [key, inlineValue] = arg.slice(2).split('=', 2);
    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
      continue;
    }
    // Bare flag: only swallow the next argv when it is a VALUE, so
    // `--current-user --domain x` does not eat `--domain`. Same rule as
    // check-edge-tls.mjs.
    const next = rawArgs[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      parsed[key] = next;
      i += 1;
    } else {
      parsed[key] = '';
    }
  }
  return parsed;
}
