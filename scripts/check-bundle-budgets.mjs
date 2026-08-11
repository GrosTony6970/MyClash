#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const budgets = [
  {
    name: 'web-marketing static JavaScript',
    type: 'static',
    root: join('apps', 'web-marketing', 'dist'),
    budgetBytes: 200 * 1024,
  },
  {
    name: 'web-public critical JavaScript',
    type: 'next',
    root: join('apps', 'web-public'),
    budgetBytes: 200 * 1024,
    routes: ['/layout', '/page'],
  },
  {
    name: 'web-staff shell JavaScript',
    type: 'next',
    root: join('apps', 'web-staff'),
    budgetBytes: 500 * 1024,
    routes: ['/layout', '/page'],
  },
  {
    name: 'web-admin first-load JavaScript',
    type: 'next',
    root: join('apps', 'web-admin'),
    budgetBytes: 800 * 1024,
    routes: ['/layout', '/page'],
  },
];

const requireBuild = process.argv.includes('--require-build');
const includeNext = requireBuild || process.argv.includes('--include-next');
const failures = [];

function walkFiles(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return walkFiles(path);
    if (entry.isFile()) return [path];
    return [];
  });
}

function gzipSize(files) {
  return files.reduce((total, file) => total + gzipSync(readFileSync(file)).byteLength, 0);
}

function checkStaticBudget(budget) {
  /*
   * A budget that measures nothing passes, and that is how this one spent its
   * whole life: it pointed at apps/web-marketing/public, the hand-written site
   * kept every line of its JavaScript inline in the HTML, and so the walk found
   * zero .js files and printed "0 bytes gzip" on every run. It never weighed a
   * single byte. Astro emits real assets to dist/, so the root moved — and an
   * absent build is now reported instead of silently scoring zero.
   */
  if (!existsSync(budget.root)) {
    const message = `${budget.name}: ${budget.root} does not exist. Build the app first.`;
    if (requireBuild) failures.push(message);
    else console.warn(`${message} Skipping.`);
    return;
  }

  const jsFiles = walkFiles(budget.root).filter((file) => file.endsWith('.js'));
  const total = gzipSize(jsFiles);
  if (total > budget.budgetBytes) {
    failures.push(`${budget.name} is ${total} bytes gzip, above ${budget.budgetBytes}.`);
  }
  console.log(
    `${budget.name}: ${total} bytes gzip across ${jsFiles.length} file(s) (budget ${budget.budgetBytes}).`,
  );
}

function checkNextBudget(budget) {
  if (!includeNext) {
    console.warn(
      `${budget.name}: skipping Next.js artifact budget. Pass --include-next after fresh builds.`,
    );
    return;
  }

  const manifestPath = join(budget.root, '.next', 'app-build-manifest.json');
  if (!existsSync(manifestPath)) {
    const message = `${budget.name}: missing ${manifestPath}. Run next build first.`;
    if (requireBuild) failures.push(message);
    else console.warn(`${message} Skipping artifact-dependent budget.`);
    return;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const pages = manifest.pages ?? {};
  const assets = new Set();
  for (const route of budget.routes) {
    for (const asset of pages[route] ?? []) {
      if (asset.endsWith('.js')) assets.add(asset);
    }
  }

  const files = [...assets]
    .map((asset) => join(budget.root, '.next', asset))
    .filter((asset) => statSync(asset, { throwIfNoEntry: false })?.isFile());
  const total = gzipSize(files);

  if (files.length === 0) {
    failures.push(`${budget.name}: no JavaScript assets found in app-build-manifest.json.`);
  } else if (total > budget.budgetBytes) {
    failures.push(`${budget.name} is ${total} bytes gzip, above ${budget.budgetBytes}.`);
  }

  console.log(`${budget.name}: ${total} bytes gzip (budget ${budget.budgetBytes}).`);
}

for (const budget of budgets) {
  if (budget.type === 'static') checkStaticBudget(budget);
  else checkNextBudget(budget);
}

if (failures.length > 0) {
  console.error(
    ['Bundle budget check failed:', ...failures.map((failure) => `- ${failure}`)].join('\n'),
  );
  process.exitCode = 1;
} else {
  console.log('Bundle budget checks passed.');
}
