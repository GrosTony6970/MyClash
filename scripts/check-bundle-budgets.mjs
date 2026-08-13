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
 *
 * ── Why there is a SECOND figure per Next app ───────────────────────────────
 * `rootMainFiles` is only half of what a page load pulls. The other half is the
 * root layout's own client module graph, which Next records as `entryJSFiles`
 * in each route's `page_client-reference-manifest.js`. The two sets are
 * disjoint — measured across all three apps, zero chunks in common — so a
 * shell-only budget cannot see anything the layout drags in.
 *
 * It missed two large ones. `packages/ui` pulled lucide-react's whole
 * 2,011-icon barrel (188 KB gzip) and every app's I18nProvider pulls the entire
 * EN+FR dictionary (181 KB gzip). Both sit in the layout entry, so both are
 * downloaded on every page load of every app, and the shell budgets stayed
 * green through all of it — the icon barrel's own source comment cited exactly
 * that to argue the cost did not matter.
 *
 * So `page-load` budgets weigh the UNION. That is the figure a visitor pays.
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
  // Shell + root-layout entry: everything a page load pulls. Baselined from the
  // measured figures after the lucide barrel came out (455,561 / 462,759 /
  // 463,031), with headroom. These come down again when the dictionary is split
  // per surface — re-baseline then rather than leaving slack nothing can use.
  {
    name: 'web-public every page load',
    type: 'page-load',
    root: join('apps', 'web-public'),
    app: 'web-public',
    budgetBytes: 480 * 1024,
  },
  {
    name: 'web-staff every page load',
    type: 'page-load',
    root: join('apps', 'web-staff'),
    app: 'web-staff',
    budgetBytes: 480 * 1024,
  },
  {
    name: 'web-admin every page load',
    type: 'page-load',
    root: join('apps', 'web-admin'),
    app: 'web-admin',
    budgetBytes: 480 * 1024,
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
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return clientReferenceManifests(path);
    return entry.name.endsWith('_client-reference-manifest.js') ? [path] : [];
  });
}

/**
 * Shell + root-layout entry, gzipped. Fails loudly when either half comes back
 * empty: a half that silently resolves to nothing turns this into a smaller
 * budget that still passes, which is the exact failure the static budget's
 * anti-vacuity assertion exists to prevent.
 */
export function checkPageLoadBudget(budget, { includeNext = false, requireBuild = false } = {}) {
  if (!includeNext) {
    return {
      warnings: [
        `${budget.name}: skipping page-load budget. Pass --include-next after a fresh build.`,
      ],
    };
  }

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
          'Reconcile with apps/web-public/scripts/landing-bundle-budget.mjs.',
      ],
    };
  }

  let entry = [];
  for (const manifest of clientReferenceManifests(join(budget.root, '.next', 'server', 'app'))) {
    entry = layoutEntryJsFiles(readFileSync(manifest, 'utf8'), budget.app);
    if (entry.length > 0) break;
  }
  if (entry.length === 0) {
    return {
      failures: [
        `${budget.name}: no route names "[project]/apps/${budget.app}/app/layout" under ` +
          'entryJSFiles. Next has changed the client-reference manifest shape, and this budget ' +
          'would silently fall back to measuring the shell alone.',
      ],
    };
  }

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
  // The two flags are independent. `--require-build` used to imply
  // `--include-next`, which left no way to say "the static build must exist"
  // without also demanding three Next builds — and that is exactly what CI
  // needs, since the Lint job builds the marketing site and nothing else.
  const requireBuild = process.argv.includes('--require-build');
  const includeNext = process.argv.includes('--include-next');
  const options = { includeNext, requireBuild };

  const failures = [];
  for (const budget of budgets) {
    const check =
      budget.type === 'static'
        ? checkStaticBudget
        : budget.type === 'page-load'
          ? checkPageLoadBudget
          : checkNextBudget;
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
