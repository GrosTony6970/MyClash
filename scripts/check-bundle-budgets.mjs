#!/usr/bin/env node
/**
 * Gzip budgets for the JavaScript each app ships.
 *
 * ── What a Next budget weighs, and why it is the union ──────────────────────
 * `build-manifest.json`'s `rootMainFiles` is the root shell: the shared chunks
 * every route loads. It is only half of what a page load pulls. The other half
 * is the root layout's own client module graph, which Next records as
 * `entryJSFiles` in each route's `page_client-reference-manifest.js`. The two
 * sets are disjoint — measured across all three apps, zero chunks in common —
 * so a shell-only budget cannot see anything the layout drags in.
 *
 * It missed two large ones. `packages/ui` pulled lucide-react's whole
 * 2,011-icon barrel (188 KB gzip) and every app's I18nProvider pulled the
 * entire EN+FR dictionary (181 KB gzip). Both sat in the layout entry, so both
 * were downloaded on every page load of every app, and the shell budgets stayed
 * green through all of it — the icon barrel's own source comment cited exactly
 * that to argue the cost did not matter. Both were found by hand and fixed
 * (209766a5, 34ab639e); neither was found by this file.
 *
 * So `page-load` budgets weigh the UNION. That is the figure a visitor pays.
 *
 * ── Why there is no separate shell budget ───────────────────────────────────
 * There were three, one per app, and they are gone. A page-load budget already
 * contains every chunk a shell budget weighed, so the shell figure could only
 * breach after the page-load figure it is a subset of had already breached.
 * What it measured on its own was the React and Next runtime and a route table:
 * across eighteen chunks in three apps, none carried an app-identifying symbol,
 * and four were byte-identical BETWEEN apps. A 400 KB payload injected into a
 * root-layout provider moved the shell figure by zero bytes.
 *
 * That made it a framework-version detector wearing a bundle budget's name —
 * it would go red on all three apps at once on a Next upgrade, and stay green
 * through anything the apps themselves shipped.
 *
 * ── The manifest history this file keeps repeating ──────────────────────────
 * The read used to be `.next/app-build-manifest.json`, which Next 16 removed
 * outright — the `APP_BUILD_MANIFEST` constant and every emission of it are
 * gone from the framework, on both Turbopack and `--webpack`. That read found
 * nothing on every modern build and scored zero as a pass. Both manifest
 * readers below therefore fail loudly on an empty result rather than returning
 * a smaller number, and both are exported so their shape is asserted in a test.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { walkAllFiles } from './lib/repo-scan.mjs';

export const budgets = [
  {
    name: 'web-marketing static JavaScript',
    type: 'static',
    root: join('apps', 'web-marketing', 'dist'),
    budgetBytes: 200 * 1024,
  },
  // Shell + root-layout entry: everything a page load pulls. Re-baselined after
  // the dictionary was split per surface — measured 331,091 / 297,379 / 428,811,
  // budgeted with ~8% headroom. Per app, because they now differ by a lot: the
  // pad reads 480 of 6,418 keys and the organiser workspace 5,257, so one shared
  // ceiling would be slack for two of them and no guard at all for the third.
  {
    name: 'web-public every page load',
    type: 'page-load',
    root: join('apps', 'web-public'),
    app: 'web-public',
    budgetBytes: 360 * 1024,
  },
  {
    name: 'web-staff every page load',
    type: 'page-load',
    root: join('apps', 'web-staff'),
    app: 'web-staff',
    budgetBytes: 320 * 1024,
  },
  {
    name: 'web-admin every page load',
    type: 'page-load',
    root: join('apps', 'web-admin'),
    app: 'web-admin',
    budgetBytes: 460 * 1024,
  },
];

/**
 * Every walk in this file is walkAllFiles, never walkRepoFiles.
 *
 * The shared REPO_IGNORED_DIRS excludes `dist` and `.next` — precisely the two
 * directories these budgets weigh. A walk that inherited it would measure a
 * subset of the build and pass, which is this file's own founding bug: it spent
 * its whole life pointed at a directory the site emitted nothing to, reporting
 * "0 bytes gzip" as a pass. repo-scan.test.mjs asserts this file never imports
 * walkRepoFiles, so the mistake cannot be reintroduced by a tidy-up.
 */
const BUILD_OUTPUT = { missingRoot: 'empty' };

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

  const allFiles = walkAllFiles(budget.root, BUILD_OUTPUT);
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

/**
 * The client chunks a route's client-reference manifest lists under the ROOT
 * LAYOUT's `entryJSFiles` — what every page of the app loads on top of the
 * shell.
 *
 * Takes the manifest's SOURCE TEXT, not parsed JSON: Next emits this file as a
 * JS assignment whose payload is sometimes an escaped string literal and
 * sometimes not, and the chunk paths read the same either way. Exported so the
 * shape is asserted in a test rather than discovered the next time Next renames
 * a field — the same reason `rootMainJsFiles` is.
 */
export function layoutEntryJsFiles(source, app) {
  const start = source.indexOf('entryJSFiles');
  if (start === -1) return [];
  const layout = source.indexOf(`/apps/${app}/app/layout`, start);
  if (layout === -1) return [];
  const segment = source.slice(layout, source.indexOf(']', layout) + 1);
  const chunks = [...segment.matchAll(/static\/chunks\/([\w.-]+\.js)/g)].map((match) => match[1]);
  return [...new Set(chunks)];
}

function clientReferenceManifests(dir) {
  return walkAllFiles(dir, BUILD_OUTPUT).filter((path) =>
    path.endsWith('_client-reference-manifest.js'),
  );
}

/** The layout entry from whichever route manifest names it first. */
function findLayoutEntry(root, app) {
  for (const manifest of clientReferenceManifests(join(root, '.next', 'server', 'app'))) {
    const entry = layoutEntryJsFiles(readFileSync(manifest, 'utf8'), app);
    if (entry.length > 0) return entry;
  }
  return [];
}

/**
 * Both halves of a page load, or the reason neither can be weighed.
 *
 * Each half fails loudly when it comes back empty. A half that silently
 * resolves to nothing turns the budget into a smaller one that still passes,
 * which is the exact failure the static budget's anti-vacuity assertion exists
 * to prevent — and the reason the shell-only budget never saw the icon barrel.
 */
function pageLoadChunks(budget, requireBuild) {
  const manifestPath = join(budget.root, '.next', 'build-manifest.json');
  if (!existsSync(manifestPath)) {
    const message = `${budget.name}: missing ${manifestPath}. Run next build first.`;
    return requireBuild ? { failures: [message] } : { warnings: [`${message} Skipping.`] };
  }

  const shell = rootMainJsFiles(JSON.parse(readFileSync(manifestPath, 'utf8')));
  if (shell.length === 0) {
    return {
      failures: [
        `${budget.name}: build-manifest.json names no rootMainFiles chunks. ` +
          'Reconcile with scripts/build-app-bundles.mjs, which produces the build this reads.',
      ],
    };
  }

  const entry = findLayoutEntry(budget.root, budget.app);
  if (entry.length === 0) {
    return {
      failures: [
        `${budget.name}: no route names "[project]/apps/${budget.app}/app/layout" under ` +
          'entryJSFiles. Next has changed the client-reference manifest shape, and this budget ' +
          'would silently fall back to measuring the shell alone.',
      ],
    };
  }

  return { shell, entry };
}

/** Shell + root-layout entry, gzipped: what a visitor pays on every page. */
export function checkPageLoadBudget(budget, { includeNext = false, requireBuild = false } = {}) {
  if (!includeNext) {
    return {
      warnings: [
        `${budget.name}: skipping page-load budget. Pass --include-next after a fresh build.`,
      ],
    };
  }

  const { shell, entry, failures, warnings } = pageLoadChunks(budget, requireBuild);
  if (failures || warnings) return { failures, warnings };

  const files = [
    ...shell.map((asset) => join(budget.root, '.next', asset)),
    ...entry.map((chunk) => join(budget.root, '.next', 'static', 'chunks', chunk)),
  ].filter(existsSync);

  const total = gzipSize(files);
  const logs = [
    `${budget.name}: ${total} bytes gzip across ${files.length} chunk(s) ` +
      `(${shell.length} shell + ${entry.length} layout, budget ${budget.budgetBytes}).`,
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
  // The two flags are independent. `--require-build` used to imply
  // `--include-next`, which left no way to say "the static build must exist"
  // without also demanding three Next builds — and that is exactly what CI
  // needs, since the Lint job builds the marketing site and nothing else.
  const requireBuild = process.argv.includes('--require-build');
  const includeNext = process.argv.includes('--include-next');
  const options = { includeNext, requireBuild };

  const failures = [];
  for (const budget of budgets) {
    const check = budget.type === 'static' ? checkStaticBudget : checkPageLoadBudget;
    const result = check(budget, options);
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
