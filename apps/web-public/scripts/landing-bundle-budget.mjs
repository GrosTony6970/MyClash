import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Budget for the app-router root shell JS that every route — including the
// landing page — loads. Re-baselined from 200KB to 230KB for Next 16: `next
// build` now defaults to Turbopack, whose shared runtime + framework chunks
// gzip to ~212KB (the old webpack bundle was ~160KB). 230KB leaves headroom
// over the current Turbopack figure while still guarding against regressions.
const budgetBytes = 230 * 1024;
const appDir = fileURLToPath(new URL('..', import.meta.url));
const nextDir = new URL('../.next/', import.meta.url);

// Next 16 removed `app-build-manifest.json` (the old App Router build manifest —
// the `APP_BUILD_MANIFEST` constant and its emission are both gone from Next's
// source). `build-manifest.json` carries the equivalent data under
// `rootMainFiles`: the shared client chunks loaded on every route, including `/`.
const manifestPath = new URL('build-manifest.json', nextDir);

if (!existsSync(manifestPath)) {
  throw new Error('Missing .next/build-manifest.json. Run next build before perf budgets.');
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const rootMainFiles = manifest.rootMainFiles ?? [];
const jsFiles = [...new Set(rootMainFiles.filter((file) => file.endsWith('.js')))];

if (jsFiles.length === 0) {
  throw new Error('No landing JavaScript assets found in build-manifest.json rootMainFiles.');
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
