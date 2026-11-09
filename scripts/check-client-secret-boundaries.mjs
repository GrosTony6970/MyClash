/**
 * Gate: no server-only secret is reachable from frontend source.
 *
 * The three web apps are shipped to browsers, so a secret named anywhere in
 * their trees is a secret in the bundle — Next inlines any literal
 * `process.env.X` it can see, and even a dead reference tells an attacker which
 * variable to go after. This is a NAME scan, not a value scan, on purpose: the
 * values differ per environment, the names do not.
 *
 * Scope is the whole of each app tree rather than a list of files. That is the
 * point of this gate: check-infra-review.mjs used to hold four of these keys as
 * per-file checks against nine hand-named pages, which left web-staff — the pad,
 * where the staff tokens live — unwatched entirely.
 */
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { defineGate } from './lib/gate.mjs';
import { walkRepoFiles } from './lib/repo-scan.mjs';

const root = process.cwd();
const frontendRoots = ['apps/web-admin', 'apps/web-public', 'apps/web-staff'];
export const forbiddenEnvKeys = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_JWT_SECRET',
  'SUPABASE_REALTIME_SECRET',
  // Signs a Realtime tenant-management token (ruling 424).
  'SUPABASE_REALTIME_API_SECRET',
  'COOKIE_SECRET',
  'MYCLASH_GUEST_JWT_SECRET',
  'MYCLASH_STAFF_JWT_SECRET',
  'AI_KEY_SECRET',
  'OPS_RUNNER_SECRET',
  'RESEND_API_KEY',
  // The Resend API key, as GoTrue's SMTP password. It replaces SMTP_PASSWORD, a name nothing
  // declares, which therefore never matched anything (ruling 511).
  'SMTP_PASS',
  'PHOTO_BUCKET_ACCESS_KEY',
  'PHOTO_BUCKET_SECRET_KEY',
  'PHOTO_TOKEN_SECRET',
  'PHOTO_DEVICE_JWT_SECRET',
  // Fifteen server secrets .env.example declared and this list missed (ruling 511; SMTP_PASS
  // above is the sixteenth), the two
  // *_AUTH ones being bcrypt basic-auth credentials. The guard below now fails the gate on the
  // next one.
  'POSTGRES_PASSWORD',
  'AUTHENTICATOR_PASSWORD',
  'SUPABASE_AUTH_ADMIN_PASSWORD',
  'SUPABASE_STORAGE_ADMIN_PASSWORD',
  'SUPABASE_REALTIME_DB_ENC_KEY',
  'STUDIO_PASSWORD',
  'TRAEFIK_DASHBOARD_PASSWORD',
  'TRAEFIK_DASHBOARD_AUTH',
  'STUDIO_BASIC_AUTH',
  'REDIS_PASSWORD',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'VAPID_PRIVATE_KEY',
  'BACKUP_SCW_ACCESS_KEY',
  'BACKUP_SCW_SECRET_KEY',
  'GITHUB_TOKEN',
  // Taken over from check-infra-review.mjs, which held them as per-file checks
  // against nine hand-named files. These four belong to whoever scans the whole
  // frontend, because a leak in the tenth file was never the less dangerous one.
  //
  // SERVICE_ROLE and service_role are the bare forms: the Postgres role name is
  // what carries the privilege, so a component naming it is a finding whether or
  // not it spells the full SUPABASE_ variable. SEED_ADMIN covers the bootstrap
  // credentials as a family — _PASSWORD is the one that mattered, _EMAIL
  // identifies the account it opens.
  'SERVICE_ROLE',
  'service_role',
  'SEED_ADMIN',
  'SEED_ADMIN_PASSWORD',
];
const scannedExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];

/** Secret-shaped names that are public by construction: they ship in every browser bundle. */
export const publicEnvKeys = [
  'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'VAPID_PUBLIC_KEY',
];

/**
 * Secrets each app's next.config.ts reads at BUILD time, in Node, and hands to a build plugin:
 * the Sentry token uploads source maps. They never reach a bundle, and they cannot be forbidden
 * without failing on the build config that needs them.
 */
export const buildTimeEnvKeys = ['SENTRY_AUTH_TOKEN'];

/**
 * Every name .env.example declares (commented-out ones too) that reads as a secret and is on
 * none of the three lists.
 *
 * The forbidden list is kept by hand, so it drifted: sixteen server secrets were missing from
 * it, SMTP_PASS among them (ruling 511). `_AUTH` is matched at the end of a name only: the
 * basic-auth credentials end that way, AUTH_GUARD_MODE and GOOGLE_OAUTH_ENABLED do not. `.env.example` is the canonical key list, so a new secret lands there first;
 * this makes it a finding until someone decides which list it belongs to.
 */
export function unclassifiedEnvKeys(
  envExample,
  classified = [...forbiddenEnvKeys, ...publicEnvKeys, ...buildTimeEnvKeys],
) {
  const declared = [...envExample.matchAll(/^#?[ \t]*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
  return [...new Set(declared)].filter(
    (name) => /SECRET|PASS|KEY|TOKEN|_AUTH$/.test(name) && !classified.includes(name),
  );
}

/**
 * The most specific keys that matched, so one occurrence is one finding.
 *
 * The list contains keys that subsume each other — SERVICE_ROLE is inside
 * SUPABASE_SERVICE_ROLE_KEY, SEED_ADMIN inside SEED_ADMIN_PASSWORD. Reporting
 * every match would name the same leak twice under two labels and read as two
 * problems. A key is dropped only when a LONGER key also matched IN THE SAME
 * FILE, which is exactly the case where it is telling you nothing new.
 *
 * Subsumption is decided by the keys that actually matched, never by the shape
 * of the list: a file naming a bare SERVICE_ROLE and nothing else still reports,
 * because the key that would have hidden it is not present in that file.
 *
 * `keys` is a parameter so this rule can be exercised against fixtures rather
 * than against the real list — a test built from the thing under test cannot
 * falsify it.
 */
export function mostSpecificMatches(source, keys = forbiddenEnvKeys) {
  const matched = keys.filter((key) => source.includes(key));
  return matched.filter((key) => !matched.some((other) => other !== key && other.includes(key)));
}

/**
 * Every leak in the frontend trees, as `path: KEY`, with the number of files
 * read alongside it.
 *
 * The count is new. This gate used to report "no server-only secrets referenced"
 * without saying what it had looked at, so a walk that reached nothing produced
 * the same clean line as a walk that reached three app trees.
 */
export function scanFrontendRoots() {
  const leaks = [];
  let scanned = 0;

  for (const frontendRoot of frontendRoots) {
    const absoluteRoot = join(root, frontendRoot);
    for (const file of walkRepoFiles(absoluteRoot, { extensions: scannedExtensions })) {
      scanned += 1;
      const source = readFileSync(file, 'utf8');
      for (const key of mostSpecificMatches(source)) {
        leaks.push(`${relative(root, file).split(sep).join('/')}: ${key}`);
      }
    }
  }

  return { leaks, scanned };
}

export const gate = defineGate({
  name: 'Server-only secrets in frontend source',
  entry: import.meta.url,
  run: () => {
    const { leaks, scanned } = scanFrontendRoots();
    const unclassified = unclassifiedEnvKeys(readFileSync(join(root, '.env.example'), 'utf8'));
    return {
      findings: [
        ...leaks,
        ...unclassified.map(
          (name) => `.env.example: ${name} is on no list (forbidden, public, build-time)`,
        ),
      ],
      scanned,
      summary: `No server-only secret environment keys across ${scanned} frontend source file(s).`,
      remedy:
        'A key reachable from client source is a key in the browser bundle. Read it on the\n' +
        'server and pass the answer, or expose a NEXT_PUBLIC_ value that is safe to publish.\n' +
        'A secret-shaped name in .env.example goes in forbiddenEnvKeys; in publicEnvKeys only\n' +
        'when it ships to browsers by design; in buildTimeEnvKeys only when next.config reads it.',
    };
  },
});
