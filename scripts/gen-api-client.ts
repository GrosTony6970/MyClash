#!/usr/bin/env tsx
/**
 * scripts/gen-api-client.ts
 *
 * Generates the TypeScript API client from the running NestJS API's OpenAPI spec.
 *
 * Usage:
 *   pnpm gen:api-client
 *
 * Prerequisites:
 *   - API must be running (pnpm --filter api dev, or docker compose up api)
 *   - API_URL env var (default: http://localhost:4000)
 *
 * Output:
 *   packages/api-client/src/generated/schema.ts  — OpenAPI types (openapi-typescript)
 *
 * The generated schema.ts is committed to the repo so apps can import types
 * without needing a running API. Re-run this script whenever the API changes.
 * (No running API available? `node apps/api/scripts/emit-openapi.cjs` emits
 * the spec offline from a built dist/.)
 *
 * packages/api-client/src/index.ts (the fetch wrapper) is HAND-MAINTAINED —
 * this script no longer overwrites it.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';
const OPENAPI_URL = `${API_URL}/api/docs-json`;
const OUT_DIR = resolve('packages/api-client/src/generated');
const OUT_FILE = join(OUT_DIR, 'schema.ts');

const ok = (m: string) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const err = (m: string) => console.error(`\x1b[31m✗\x1b[0m ${m}`);
const info = (m: string) => console.log(`  ${m}`);

async function main() {
  console.log('\n\x1b[36m\x1b[1m── Generate API client ──\x1b[0m');
  info(`OpenAPI source: ${OPENAPI_URL}`);
  info(`Output:         ${OUT_FILE}`);

  // 1. Verify API is reachable
  info('Checking API is reachable…');
  try {
    const res = await fetch(`${API_URL}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ok('API is reachable');
  } catch (e) {
    err(`Cannot reach API at ${API_URL}: ${String(e)}`);
    err('Start the API first: pnpm --filter api dev');
    process.exit(1);
  }

  // 2. Create output directory
  if (!existsSync(OUT_DIR)) {
    mkdirSync(OUT_DIR, { recursive: true });
  }

  // 3. Generate types using openapi-typescript CLI
  info('Generating TypeScript types from OpenAPI spec…');
  try {
    execSync(`pnpm exec openapi-typescript "${OPENAPI_URL}" --output "${OUT_FILE}"`, {
      stdio: 'inherit',
    });
    ok(`Types generated → ${OUT_FILE}`);
  } catch (e) {
    err(`openapi-typescript failed: ${String(e)}`);
    process.exit(1);
  }

  // 4. index.ts is hand-maintained (cookie-auth + problem+json wrapper) —
  //    only the generated schema is written by this script.

  console.log('\n\x1b[32m✓\x1b[0m API client generated successfully.');
  console.log('  Commit packages/api-client/src/generated/schema.ts to the repo.');
}

main().catch((e) => {
  err(String(e));
  process.exit(1);
});
