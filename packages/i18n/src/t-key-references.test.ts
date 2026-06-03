/**
 * t-key-references.test.ts
 *
 * Scans every front-end app source file for `t('static.key')` callsites
 * and asserts the key resolves in BOTH `messages.en` and `messages.fr`.
 *
 * Why this exists: missing keys leak to operators as bracketed
 * placeholders (`[a.b.c]`) — see `createTranslator`'s fallback at
 * src/index.ts. The EN/FR parity test catches asymmetric drift
 * between locales but lets missing-from-both keys ship. This lint
 * is the missing guard.
 *
 * Static-only on purpose: dynamic keys (template literals, string
 * concatenations, identifiers) are skipped — they can't be statically
 * resolved. The handful of legitimate dynamic-key callsites (e.g.
 * `t(\`admin.penaltyRulesets.scope.${row.accumulation_scope}\`)`) is
 * out of scope.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { messages, type Locale } from './index';

// Walk up from process.cwd() until we find a directory containing an
// `apps/` folder — that's the monorepo root regardless of where the
// test was invoked from.
function findRepoRoot(): string {
  let cur = process.cwd();
  for (let i = 0; i < 6; i++) {
    try {
      statSync(join(cur, 'apps'));
      return cur;
    } catch {
      const parent = dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }
  throw new Error('Could not locate repo root (no apps/ directory found going up from cwd)');
}

const REPO_ROOT = findRepoRoot();

// Front-end app trees that call `t()`. packages/ui + packages/rulesets
// don't render text through `t()` — they're library code consumed by
// the FE apps.
const ROOTS = [
  'apps/web-admin/app',
  'apps/web-admin/src',
  'apps/web-public/app',
  'apps/web-public/src',
  'apps/web-scoring/app',
  'apps/web-scoring/src',
];

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.turbo']);

function* walk(root: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(root, entry);
    let s;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      yield* walk(p);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      yield p;
    }
  }
}

// Matches `t('foo.bar')` or `t("foo.bar")`. Skips template literals
// (`` t(`foo.${x}`) ``), variables (`t(myKey)`), and concatenations
// (`t('foo.' + x)`).
const T_CALL_RE = /\bt\s*\(\s*(['"])([a-zA-Z][\w.]*)\1\s*[,)]/g;

function resolveKey(locale: Locale, path: string): unknown {
  let cursor: unknown = messages[locale];
  for (const seg of path.split('.')) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor;
}

interface Failure {
  file: string;
  key: string;
  line: number;
  missing: Locale[];
}

const failures: Failure[] = [];
let totalCallsites = 0;
let totalFilesScanned = 0;

for (const relRoot of ROOTS) {
  const root = resolvePath(REPO_ROOT, relRoot);
  for (const file of walk(root)) {
    totalFilesScanned++;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(T_CALL_RE)) {
      totalCallsites++;
      const key = m[2]!;
      const missing: Locale[] = (['en', 'fr'] as const).filter(
        (loc) => typeof resolveKey(loc, key) !== 'string',
      );
      if (missing.length > 0) {
        const line = text.slice(0, m.index!).split('\n').length;
        const rel = file.replace(REPO_ROOT + '/', '').replace(REPO_ROOT + '\\', '');
        failures.push({ file: rel, key, line, missing });
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} unresolved t() key reference(s):\n`);
  for (const f of failures) {
    console.error(`  ${f.file}:${f.line}  ${f.key}  missing in: ${f.missing.join(',')}`);
  }
  console.error('');
}

assert.equal(
  failures.length,
  0,
  `${failures.length} unresolved t() key reference(s). Define the missing keys in packages/i18n/src/index.ts under BOTH messages.en and messages.fr.`,
);

console.log(
  `✓ all ${totalCallsites} t() key references resolve in EN + FR (${totalFilesScanned} files scanned)`,
);
