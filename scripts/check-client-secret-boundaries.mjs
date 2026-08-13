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

import { walkRepoFiles } from './lib/repo-scan.mjs';

const root = process.cwd();
const frontendRoots = ['apps/web-admin', 'apps/web-public', 'apps/web-staff'];
export const forbiddenEnvKeys = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_JWT_SECRET',
  'SUPABASE_REALTIME_SECRET',
  'COOKIE_SECRET',
  'MYCLASH_GUEST_JWT_SECRET',
  'MYCLASH_STAFF_JWT_SECRET',
  'AI_KEY_SECRET',
  'OPS_RUNNER_SECRET',
  'RESEND_API_KEY',
  'SMTP_PASSWORD',
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

/** Every leak in the frontend trees, as `path: KEY`. */
export function scanFrontendRoots() {
  const leaks = [];
  for (const frontendRoot of frontendRoots) {
    const absoluteRoot = join(root, frontendRoot);
    for (const file of walkRepoFiles(absoluteRoot, { extensions: scannedExtensions })) {
      const source = readFileSync(file, 'utf8');
      for (const key of mostSpecificMatches(source)) {
        leaks.push(`${relative(root, file).split(sep).join('/')}: ${key}`);
      }
    }
  }
  return leaks;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
// Guarded so the test file can import the rules without running a scan.
const invokedDirectly = process.argv[1]?.endsWith('check-client-secret-boundaries.mjs');
if (invokedDirectly) {
  const leaks = scanFrontendRoots();
  if (leaks.length) {
    console.error('Server-only secrets referenced from frontend source:');
    for (const leak of leaks) console.error(`  - ${leak}`);
    process.exit(1);
  }

  console.log('Frontend source does not reference server-only secret environment keys.');
}
