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

const repoRoot = process.cwd();
const committedPath = join(repoRoot, 'packages/api-client/src/generated/schema.ts');
const emitScript = join(repoRoot, 'apps/api/scripts/emit-openapi.cjs');
const apiDist = join(repoRoot, 'apps/api/dist/app.module.js');
const write = process.argv.includes('--write');

if (!existsSync(apiDist)) {
  console.error(
    'apps/api/dist is missing. Run `pnpm --filter @myclash/api build` first —\n' +
      'the OpenAPI document is built from the COMPILED app, not from source.',
  );
  process.exit(1);
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

function resolveBin(fromPackageJson, packageName) {
  const requireFrom = createRequire(fromPackageJson);
  const manifestPath = requireFrom.resolve(`${packageName}/package.json`);
  const { bin } = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const relative = typeof bin === 'string' ? bin : bin[packageName];
  return join(dirname(manifestPath), relative);
}

const workDir = mkdtempSync(join(tmpdir(), 'openapi-drift-'));

// ── Why cleanup is an 'exit' handler and not a `finally` ────────────────────
// Every path out of the work below ends in process.exit(). That terminates the
// process immediately and does NOT unwind the stack, so the `finally` block this
// replaces never ran — on any path, success included. The gate leaked its temp
// directory on every CI push and every local run from the day it was written;
// 344 of them had piled up on one developer machine before anybody looked.
//
// 'exit' fires on all three ways out of this file: falling off the end,
// process.exit(), and an uncaught exception. Only synchronous work is possible
// in an exit handler, which rmSync is.
process.on('exit', () => rmSync(workDir, { recursive: true, force: true }));

const openapiPath = join(workDir, 'openapi.json');
const generatedPath = join(workDir, 'schema.ts');

execFileSync(process.execPath, [emitScript, openapiPath], { stdio: 'pipe' });
execFileSync(process.execPath, [openapiTypescriptCli, openapiPath, '--output', generatedPath], {
  stdio: 'pipe',
});

// Compare formatted, so the check tracks CONTENT and never trips on the
// prettier pass the pre-commit hook applies to the committed copy.
const formatted = format(readFileSync(generatedPath, 'utf8'));

if (write) {
  writeFileSync(committedPath, formatted);
  console.log('Regenerated packages/api-client/src/generated/schema.ts');
  process.exit(0);
}

const committed = readFileSync(committedPath, 'utf8');
if (committed === formatted) {
  console.log(`OpenAPI client is up to date (${routeCount(formatted)} routes).`);
  process.exit(0);
}

const added = routes(formatted).filter((r) => !routes(committed).includes(r));
const removed = routes(committed).filter((r) => !routes(formatted).includes(r));
console.error('packages/api-client/src/generated/schema.ts is out of date.\n');
if (added.length > 0) console.error(`  ${added.length} route(s) missing from the client:`);
for (const r of added.slice(0, 20)) console.error(`    + ${r}`);
if (removed.length > 0) console.error(`  ${removed.length} route(s) no longer on the API:`);
for (const r of removed.slice(0, 20)) console.error(`    - ${r}`);
console.error('\nRegenerate with:  pnpm openapi:client');
process.exit(1);

function format(source) {
  return execFileSync(process.execPath, [prettierCli, '--stdin-filepath', committedPath], {
    input: source,
    encoding: 'utf8',
  });
}

function routes(source) {
  return [...source.matchAll(/['"](\/api\/v1\/[^'"]*)['"]:\s*\{/g)].map((m) => m[1]);
}

function routeCount(source) {
  return new Set(routes(source)).size;
}
