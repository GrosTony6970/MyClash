import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = process.cwd();
const frontendRoots = ['apps/web-admin', 'apps/web-public', 'apps/web-scoring'];
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
];
const scannedExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json']);

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === 'node_modules' || entry === '.next' || entry === 'dist' || entry === 'coverage') {
      return [];
    }
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function hasScannedExtension(path) {
  return [...scannedExtensions].some((extension) => path.endsWith(extension));
}

const leaks = [];
for (const frontendRoot of frontendRoots) {
  const absoluteRoot = join(root, frontendRoot);
  for (const file of walk(absoluteRoot).filter(hasScannedExtension)) {
    const source = readFileSync(file, 'utf8');
    for (const key of forbiddenEnvKeys) {
      if (source.includes(key)) {
        leaks.push(`${relative(root, file).split(sep).join('/')}: ${key}`);
      }
    }
  }
}

if (leaks.length) {
  console.error('Server-only secrets referenced from frontend source:');
  for (const leak of leaks) console.error(`  - ${leak}`);
  process.exit(1);
}

console.log('Frontend source does not reference server-only secret environment keys.');
