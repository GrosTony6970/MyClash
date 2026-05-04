import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const budgetBytes = 200 * 1024;
const appDir = fileURLToPath(new URL('..', import.meta.url));
const nextDir = new URL('../.next/', import.meta.url);
const manifestPath = new URL('app-build-manifest.json', nextDir);

if (!existsSync(manifestPath)) {
  throw new Error('Missing .next/app-build-manifest.json. Run next build before perf budgets.');
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const pages = manifest.pages ?? {};
const landingFiles = [...(pages['/layout'] ?? []), ...(pages['/page'] ?? [])];
const jsFiles = [...new Set(landingFiles.filter((file) => file.endsWith('.js')))];

if (jsFiles.length === 0) {
  throw new Error('No landing JavaScript assets found in app-build-manifest.json.');
}

let total = 0;
for (const file of jsFiles) {
  const assetPath = join(appDir, '.next', file);
  const source = readFileSync(assetPath);
  total += gzipSync(source).byteLength;
}

if (total > budgetBytes) {
  throw new Error(
    `web-public landing JS is ${total} bytes gzip, above ${budgetBytes} byte budget.`,
  );
}

console.log(`web-public landing JS: ${total} bytes gzip (budget ${budgetBytes}).`);
