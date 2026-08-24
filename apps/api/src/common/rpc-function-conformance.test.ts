import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { apiSourceFiles } from './testing/supabase-query-scan';

/**
 * Every `.rpc('name')` must name a function some migration creates.
 *
 * `db-schema-conformance.test.ts` next door checks `(table, column)` pairs and
 * has never looked at `.rpc()`, so nothing held this. A renamed or never-created
 * function fails only when the route runs — and the read sites deliberately
 * degrade rather than throw ("a database that has not taken 0188 yet"), so it
 * fails as an empty page rather than a 500. That posture is right, and it is
 * exactly what makes a typo invisible.
 *
 * It reuses `apiSourceFiles`, the same walk the column scan uses, so a new
 * module cannot sit outside both checks.
 *
 * ONE call site names its function dynamically — `ai-key-store.ts` reads it from
 * config — so it carries no string literal and this cannot see it. That is a
 * known hole, not an oversight: a check over literals cannot follow a value.
 */

const API_SRC = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'db',
  'migrations',
);

/** Every `.rpc('name'` literal in the API source, with the file it sits in. */
function rpcCallSites(): Array<{ file: string; fn: string }> {
  const sites: Array<{ file: string; fn: string }> = [];
  for (const file of apiSourceFiles(API_SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\.rpc\(\s*['"]([\w$]+)['"]/gu)) {
      sites.push({ file: path.relative(API_SRC, file), fn: match[1] as string });
    }
  }
  return sites;
}

/** Every function name any migration creates. */
function migrationFunctionNames(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql'))) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    for (const match of sql.matchAll(
      /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([\w$]+)\s*\(/giu,
    )) {
      names.add((match[1] as string).toLowerCase());
    }
  }
  return names;
}

describe('every .rpc() names a function the migrations create', () => {
  const sites = rpcCallSites();
  const declared = migrationFunctionNames();

  it('scans a non-empty corpus on both sides', () => {
    // Without this the whole check passes by finding nothing — a restructure
    // that moved the API sources, or a migrations path that stopped resolving,
    // would read as success.
    expect(sites.length, 'no .rpc( call sites found in apps/api/src').toBeGreaterThan(0);
    expect(declared.size, 'no CREATE FUNCTION found in packages/db/migrations').toBeGreaterThan(0);
  });

  it('names only functions that exist', () => {
    const missing = sites.filter((site) => !declared.has(site.fn.toLowerCase()));

    expect(
      missing.map((site) => `${site.file}: ${site.fn}`),
      'these rpc names match no CREATE FUNCTION in any migration',
    ).toEqual([]);
  });
});
