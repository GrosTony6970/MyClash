/**
 * OpenAPI client drift gate.
 *
 * Regenerates the typed API client into a temp file and fails when it differs
 * from the committed packages/api-client/src/generated/schema.ts.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The client is generated, but nothing ever checked that the committed copy
 * matched the API. It could not even be regenerated: FormulaNodeSchema built a
 * fresh subschema per recursion level to a depth of 32, so converting it to
 * JSON Schema meant materialising 2^32 nodes and `SwaggerModule.createDocument`
 * OOM'd at any heap size (fixed in c612924e).
 *
 * That was invisible for two months. By the time it surfaced the committed
 * client was missing 36 routes and still advertised 5 that had been deleted —
 * a typed contract that quietly disagreed with the server it described.
 *
 * A generated artifact with no drift check is a stale artifact waiting to
 * happen, so: emit, generate, diff, fail loudly.
 *
 * Usage:  node scripts/check-openapi-drift.mjs          (verify)
 *         node scripts/check-openapi-drift.mjs --write  (regenerate in place)
 *
 * Requires apps/api/dist — run `pnpm --filter @myclash/api build` first.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { defineGate } from './lib/gate.mjs';

const repoRoot = process.cwd();
const committedPath = join(repoRoot, 'packages/api-client/src/generated/schema.ts');
const emitScript = join(repoRoot, 'apps/api/scripts/emit-openapi.cjs');
const apiDist = join(repoRoot, 'apps/api/dist/app.module.js');

function resolveBin(fromPackageJson, packageName) {
  const requireFrom = createRequire(fromPackageJson);
  const manifestPath = requireFrom.resolve(`${packageName}/package.json`);
  const { bin } = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const relative = typeof bin === 'string' ? bin : bin[packageName];
  return join(dirname(manifestPath), relative);
}

// openapi-typescript is a devDependency of packages/api-client, so resolve it
// from there rather than assuming a hoisted root node_modules (pnpm's is not).
// Resolved via the package's own `bin` field: its exports map does not expose
// the CLI, so a direct `resolve('openapi-typescript/bin/cli.js')` fails.
const openapiTypescriptCli = resolveBin(
  join(repoRoot, 'packages/api-client/package.json'),
  'openapi-typescript',
);
const prettierCli = resolveBin(join(repoRoot, 'package.json'), 'prettier');

export function routes(source) {
  return [...source.matchAll(/['"](\/api\/v1\/[^'"]*)['"]:\s*\{/g)].map((m) => m[1]);
}

export function routeCount(source) {
  return new Set(routes(source)).size;
}

/** Whether this invocation regenerates the client instead of checking it. */
export function isWriteMode(argv) {
  return argv.includes('--write');
}

/**
 * The drift between the committed client and a freshly generated one.
 *
 * Route-by-route rather than a diff, because the useful question is which
 * ROUTES disagree: the committed client was once missing 36 of them while still
 * advertising 5 that had been deleted, and no line diff would have said so.
 * Capped, because a client that has drifted far enough produces a wall nobody
 * reads and the fix is the same either way.
 */
export function driftFindings(committed, formatted, cap = 20) {
  if (committed === formatted) return [];

  const inClient = new Set(routes(committed));
  const onApi = new Set(routes(formatted));
  const added = [...onApi].filter((route) => !inClient.has(route));
  const removed = [...inClient].filter((route) => !onApi.has(route));
  const findings = [];

  for (const route of added.slice(0, cap))
    findings.push(`+ ${route} is on the API, not in the client`);
  for (const route of removed.slice(0, cap))
    findings.push(`- ${route} is in the client, not on the API`);
  for (const [label, list] of [
    ['on the API', added],
    ['in the client', removed],
  ]) {
    if (list.length > cap) findings.push(`… and ${list.length - cap} more route(s) ${label}`);
  }

  // Content can differ with no route added or removed — a changed request body,
  // a renamed schema. Saying nothing there would report drift with an empty list.
  if (!findings.length) {
    findings.push('the route list matches, but the generated types differ');
  }

  return findings;
}

/** Emit the OpenAPI document, generate the client from it, and format it. */
function generate() {
  const workDir = mkdtempSync(join(tmpdir(), 'openapi-drift-'));
  // Cleanup on 'exit' rather than in a `finally`. The harness never calls
  // process.exit, so a `finally` would run today — but this file spent its whole
  // life leaking 344 temp directories because one did not, and an exit handler
  // cannot be undone by a future control-flow change.
  process.on('exit', () => rmSync(workDir, { recursive: true, force: true }));

  const openapiPath = join(workDir, 'openapi.json');
  const generatedPath = join(workDir, 'schema.ts');
  execFileSync(process.execPath, [emitScript, openapiPath], { stdio: 'pipe' });
  execFileSync(process.execPath, [openapiTypescriptCli, openapiPath, '--output', generatedPath], {
    stdio: 'pipe',
  });

  // Compare formatted, so the check tracks CONTENT and never trips on the
  // prettier pass the pre-commit hook applies to the committed copy.
  return execFileSync(process.execPath, [prettierCli, '--stdin-filepath', committedPath], {
    input: readFileSync(generatedPath, 'utf8'),
    encoding: 'utf8',
  });
}

export const gate = defineGate({
  name: 'OpenAPI client drift',
  entry: import.meta.url,
  run: ({ argv }) => {
    if (!existsSync(apiDist)) {
      throw new Error(
        'apps/api/dist is missing. Run `pnpm --filter @myclash/api build` first —\n' +
          'the OpenAPI document is built from the COMPILED app, not from source.',
      );
    }

    const formatted = generate();

    if (isWriteMode(argv)) {
      writeFileSync(committedPath, formatted);
      return {
        findings: [],
        scanned: routeCount(formatted),
        summary: `Regenerated packages/api-client/src/generated/schema.ts (${routeCount(formatted)} routes).`,
      };
    }

    return {
      findings: driftFindings(readFileSync(committedPath, 'utf8'), formatted),
      // Routes, not files: an emit that produced an empty document would other-
      // wise compare two nothings and pass. This gate exists because exactly
      // that went unnoticed for two months.
      scanned: routeCount(formatted),
      summary: `OpenAPI client is up to date (${routeCount(formatted)} routes).`,
      remedy: 'Regenerate with:  pnpm openapi:client',
    };
  },
});
