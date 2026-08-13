#!/usr/bin/env node
/**
 * Gzip budgets for the JavaScript each app ships.
 *
 * ── Why the Next budgets read build-manifest.json ───────────────────────────
 * They used to read `.next/app-build-manifest.json` and pick assets per route.
 * Next 16 removed that file outright — the `APP_BUILD_MANIFEST` constant and
 * every emission of it are gone from Next's source, on both Turbopack and
 * `--webpack`. The read therefore found nothing on every modern build.
 *
 * The same bug was found and fixed in apps/web-public/scripts/landing-bundle-budget.mjs
 * on 2026-07-23; this copy never got the fix, and nothing noticed because no
 * workflow ran it. `build-manifest.json` carries the equivalent data under
 * `rootMainFiles`: the shared client chunks every route loads.
 *
 * Because `rootMainFiles` is the root shell rather than a per-route set, the
 * budgets no longer name routes — there is one shell figure per app.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

export const budgets = [
  {
    name: 'web-marketing static JavaScript',
    type: 'static',
    root: join('apps', 'web-marketing', 'dist'),
    budgetBytes: 200 * 1024,
  },
  {
    // apps/web-public/scripts/landing-bundle-budget.mjs is the authority on
    // this number and runs inside web-public's own test chain; the figure is
    // mirrored here so a full sweep covers the same ground. Both were
    // re-baselined 200KB → 230KB for Next 16: `next build` defaults to
    // Turbopack, whose shared runtime + framework chunks gzip to ~212KB where
    // the old webpack bundle was ~160KB.
    name: 'web-public root shell JavaScript',
    type: 'next',
    root: join('apps', 'web-public'),
    budgetBytes: 230 * 1024,
  },
  {
    name: 'web-staff root shell JavaScript',
    type: 'next',
    root: join('apps', 'web-staff'),
    budgetBytes: 500 * 1024,
  },
  {
    name: 'web-admin root shell JavaScript',
    type: 'next',
    root: join('apps', 'web-admin'),
    budgetBytes: 800 * 1024,
  },
];

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

/**
 * The shared client chunks every route loads, from a parsed build-manifest.json.
 *
 * Exported so the manifest shape is asserted in a test rather than discovered
 * the next time Next renames a field — which is the whole history of this file.
 */
export function rootMainJsFiles(manifest) {
  const rootMainFiles = manifest?.rootMainFiles ?? [];
  return [...new Set(rootMainFiles.filter((file) => file.endsWith('.js')))];
}

/**
 * A budget over emitted static assets.
 *
 * ── The anti-vacuity assertion ──────────────────────────────────────────────
 * This budget spent its whole life measuring nothing: it pointed at
 * apps/web-marketing/public, where the hand-written site kept every line of its
 * JavaScript inline in the HTML, so the walk found zero .js files and printed
 * "0 bytes gzip" as a pass on every run. Astro emits real assets to dist/, so
 * the root moved — but the vacuity did not, because zero files still passed.
 *
 * Zero .js files is nonetheless the CORRECT result for this site: Astro inlines
 * its few KB of script. So zero JavaScript is not the failure — an empty scan
 * root is. A root holding no files at all means the walk is pointed at
 * somewhere that is not a build, which is the failure the old root move was
 * really about.
 */
export function checkStaticBudget(budget, { requireBuild = false } = {}) {
  if (!existsSync(budget.root)) {
    const message = `${budget.name}: ${budget.root} does not exist. Build the app first.`;
    return requireBuild ? { failures: [message] } : { warnings: [`${message} Skipping.`] };
  }

  const allFiles = walkFiles(budget.root);
  if (allFiles.length === 0) {
    return {
      failures: [
        `${budget.name}: ${budget.root} exists but holds no files at all. ` +
          'A budget over an empty root measures nothing and passes; point it at a real build output.',
      ],
    };
  }

  const jsFiles = allFiles.filter((file) => file.endsWith('.js'));
  const total = gzipSize(jsFiles);
  const logs = [
    `${budget.name}: ${total} bytes gzip across ${jsFiles.length} file(s) of ${allFiles.length} emitted (budget ${budget.budgetBytes}).`,
  ];
  if (jsFiles.length === 0) {
    // Stated rather than silent, so a genuinely inlined site is distinguishable
    // in the log from a budget that has quietly stopped finding anything.
    logs.push(`${budget.name}: no emitted JavaScript — this site inlines its script.`);
  }
  if (total > budget.budgetBytes) {
    return {
      failures: [`${budget.name} is ${total} bytes gzip, above ${budget.budgetBytes}.`],
      logs,
    };
  }
  return { logs };
}

export function checkNextBudget(budget, { includeNext = false, requireBuild = false } = {}) {
  if (!includeNext) {
    return {
      warnings: [
        `${budget.name}: skipping Next.js artifact budget. Pass --include-next after fresh builds.`,
      ],
    };
  }

  const manifestPath = join(budget.root, '.next', 'build-manifest.json');
  if (!existsSync(manifestPath)) {
    const message = `${budget.name}: missing ${manifestPath}. Run next build first.`;
    return requireBuild
      ? { failures: [message] }
      : { warnings: [`${message} Skipping artifact-dependent budget.`] };
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const assets = rootMainJsFiles(manifest);
  if (assets.length === 0) {
    return {
      failures: [
        `${budget.name}: no JavaScript assets found in build-manifest.json rootMainFiles. ` +
          'Next has renamed the manifest field again — reconcile with apps/web-public/scripts/landing-bundle-budget.mjs.',
      ],
    };
  }

  const files = assets.map((asset) => join(budget.root, '.next', asset)).filter(existsSync);
  if (files.length === 0) {
    return {
      failures: [
        `${budget.name}: build-manifest.json names ${assets.length} chunk(s), none of which exist on disk.`,
      ],
    };
  }

  const total = gzipSize(files);
  const logs = [
    `${budget.name}: ${total} bytes gzip across ${files.length} chunk(s) (budget ${budget.budgetBytes}).`,
  ];
  if (total > budget.budgetBytes) {
    return {
      failures: [`${budget.name} is ${total} bytes gzip, above ${budget.budgetBytes}.`],
      logs,
    };
  }
  return { logs };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
// Guarded so the test file can import the checks without running a scan.
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('check-bundle-budgets.mjs');
if (invokedDirectly) {
  const requireBuild = process.argv.includes('--require-build');
  const includeNext = requireBuild || process.argv.includes('--include-next');
  const options = { includeNext, requireBuild };

  const failures = [];
  for (const budget of budgets) {
    const result =
      budget.type === 'static'
        ? checkStaticBudget(budget, options)
        : checkNextBudget(budget, options);
    for (const line of result.logs ?? []) console.log(line);
    for (const line of result.warnings ?? []) console.warn(line);
    failures.push(...(result.failures ?? []));
  }

  if (failures.length > 0) {
    console.error(
      ['Bundle budget check failed:', ...failures.map((failure) => `- ${failure}`)].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log('Bundle budget checks passed.');
  }
}
