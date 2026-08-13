import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { walkRepoFiles } from './lib/repo-scan.mjs';

const root = process.cwd();
const frontendRoots = ['apps/web-admin', 'apps/web-public', 'apps/web-staff'];
const forbiddenEnvKeys = [
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
 * The most specific key that matched, so one occurrence is one finding.
 *
 * The list now contains keys that subsume each other — SERVICE_ROLE is inside
 * SUPABASE_SERVICE_ROLE_KEY, SEED_ADMIN inside SEED_ADMIN_PASSWORD. Reporting
 * every match would name the same leak twice under two labels and read as two
 * problems. A key is dropped only when a LONGER key also matched in the same
 * file, which is exactly the case where it is telling you nothing new.
 */
function mostSpecificMatches(source) {
  const matched = forbiddenEnvKeys.filter((key) => source.includes(key));
  return matched.filter((key) => !matched.some((other) => other !== key && other.includes(key)));
}

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

if (leaks.length) {
  console.error('Server-only secrets referenced from frontend source:');
  for (const leak of leaks) console.error(`  - ${leak}`);
  process.exit(1);
}

console.log('Frontend source does not reference server-only secret environment keys.');
