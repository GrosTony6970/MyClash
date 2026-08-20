/**
 * t-key-references.test.ts
 *
 * Two-directional guard over the i18n key set, scanning the front-end app
 * trees plus the `t()`-consuming shared packages (@myclash/ui,
 * @myclash/feature-flags):
 *
 *   FORWARD (reference → key): every static `t('static.key')` callsite must
 *   resolve in BOTH `messages.en` and `messages.fr`. Missing keys otherwise
 *   leak to operators as bracketed placeholders (`[a.b.c]`) — see
 *   `createTranslator`'s fallback in src/index.ts.
 *
 *   REVERSE (key → reference): every leaf key defined in `messages.en` must be
 *   referenced somewhere in the scanned source — as a static `t()` key, as any
 *   dotted-path string literal (key-map constants like `STATUS_KEYS`, config
 *   `labelKey`/`descriptionKey` fields, feature-flag registries), or under a
 *   dynamic-composition prefix. This catches orphaned keys so the tree can't
 *   silently accumulate dead weight (bundle bloat + translator confusion).
 *
 * Dynamic keys can't be statically enumerated, so the reverse sweep treats a
 * key as referenced when it is covered by a composition prefix. Two prefix
 * sources are combined:
 *   1. AUTO — the static prefix of every interpolated template literal in
 *      source (e.g. `` `organizer.events.statuses.${x}` `` → whitelists
 *      `organizer.events.statuses.*`). Includes templates built into a variable
 *      before being passed to `t()` (e.g. system-versions component/group keys).
 *   2. MANUAL — variable-base compositions whose prefix is a `const`, not a
 *      literal in the template, so AUTO can't see it:
 *        - `` `${ns}.keys.${leaf}` `` in @myclash/ui AiKeys* (ns is a prop) →
 *          the two namespaces it is instantiated with;
 *        - `` `${HELP_KEY_BASE}.${leaf}` `` in standings/columnHelp.ts.
 * When a genuinely-dynamic key family is added, extend MANUAL_PREFIXES (or, if
 * the composition uses an inline template prefix, AUTO picks it up for free).
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { messages, type Locale } from './index';

// Walk up from process.cwd() until we find a directory containing an `apps/`
// folder — that's the monorepo root regardless of where the test was invoked.
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

// Every surface that references i18n keys: the three FE app trees plus the
// shared packages that call `t()` / hold key literals. Verified exhaustive —
// no key is referenced only outside this set (packages/i18n itself excluded;
// the API never renders `t()`).
//
// A root missing from this list does not weaken the FORWARD check, it breaks
// the REVERSE one: keys referenced only from an unscanned directory are
// reported as orphans and the suite tells you to delete strings that are very
// much in use. That is exactly what happened when the language switcher moved
// out of apps/*/src/i18n and into @myclash/next-i18n — three `navigation.*`
// keys went orphaned the moment the last app copy was deleted.
const ROOTS = [
  'apps/web-admin/app',
  'apps/web-admin/src',
  'apps/web-public/app',
  'apps/web-public/src',
  'apps/web-staff/app',
  'apps/web-staff/src',
  'packages/ui/src',
  'packages/next-i18n/src',
  'packages/feature-flags/src',
  // `failureMessage` names `common.apiFailure.*` and `common.error` but calls
  // no `t()` of its own — it takes the translator as a parameter, so the app
  // that renders the sentence is not the module that chooses the key. Without
  // this root those keys are referenced from nowhere the sweep can see, and it
  // asks you to delete strings that ship on every failed request.
  'packages/api-client/src',
  // Holds key literals without calling `t()`: roundTokenLabel() maps a round
  // token to an i18n key so the module can stay locale-agnostic. Whitelisting
  // the `common.round.` prefix instead would have exempted that whole family
  // from the orphan check forever.
  'packages/types/src',
];

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.turbo', 'coverage']);

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

// Static `t('foo.bar')` / `t("foo.bar")`. Skips template literals, variables,
// and concatenations (they can't be statically resolved).
const T_CALL_RE = /\bt\s*\(\s*(['"])([a-zA-Z][\w.]*)\1\s*[,)]/g;
// Any quoted string whose *content* is a pure dotted path — the shape of an
// i18n key. Catches static `t()` keys, key-map constant values, and
// `labelKey`/`descriptionKey` config/registry fields.
const KEYISH_LITERAL_RE = /(['"`])([a-zA-Z][\w]*(?:\.[A-Za-z0-9_]+)+)\1/g;
// Static prefix of any interpolated template literal (not just inside `t()`,
// since keys are often built into a variable first). The `.` requirement
// excludes non-i18n templates like `` `col-span-${n}` `` / `` `Bearer ${t}` ``.
const TEMPLATE_PREFIX_RE = /`([a-zA-Z][\w.]*)\$\{/g;

// Variable-base composition prefixes AUTO can't derive (see file header).
const MANUAL_PREFIXES = [
  'admin.aiSettings.keys.', // `${ns}.keys.${leaf}` — AiKeysManager ns="admin.aiSettings"
  'publicApp.meSettings.ai.keys.', // `${ns}.keys.${leaf}` — AiKeysManager ns="publicApp.meSettings.ai"
  'organizer.pools.standings.help.', // `${HELP_KEY_BASE}.${leaf}` — standings/columnHelp.ts
  // `admin.adminLeagues.freshness.${state}` — LeagueFreshnessBadge keys the
  // label off the API's LeagueFreshnessState union.
  'admin.adminLeagues.freshness.',
];
// Deliberate non-UI fixtures kept in the tree on purpose.
const KEEP_PREFIXES = ['test.'];

function resolveKey(locale: Locale, path: string): unknown {
  let cursor: unknown = messages[locale];
  for (const seg of path.split('.')) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor;
}

function collectLeafKeys(node: unknown, prefix: string, out: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.add(path);
    else collectLeafKeys(v, path, out);
  }
}

// ---- single scan of the source tree ----
const staticKeys = new Map<string, { file: string; line: number }>();
const keyishLiterals = new Set<string>();
const autoPrefixes = new Set<string>();
let totalFilesScanned = 0;

for (const relRoot of ROOTS) {
  const root = resolvePath(REPO_ROOT, relRoot);
  for (const file of walk(root)) {
    totalFilesScanned++;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(T_CALL_RE)) {
      const key = m[2]!;
      if (!staticKeys.has(key)) {
        const line = text.slice(0, m.index!).split('\n').length;
        const rel = file.replace(REPO_ROOT + '/', '').replace(REPO_ROOT + '\\', '');
        staticKeys.set(key, { file: rel, line });
      }
    }
    for (const m of text.matchAll(KEYISH_LITERAL_RE)) keyishLiterals.add(m[2]!);
    for (const m of text.matchAll(TEMPLATE_PREFIX_RE)) {
      const prefix = m[1]!;
      if (prefix.includes('.') && prefix.length >= 3) autoPrefixes.add(prefix);
    }
  }
}

const allPrefixes = [...autoPrefixes, ...MANUAL_PREFIXES];
function coveredByPrefix(key: string): boolean {
  for (const p of allPrefixes) if (key === p || key.startsWith(p)) return true;
  for (const p of KEEP_PREFIXES) if (key === p || key.startsWith(p)) return true;
  return false;
}

// ---- FORWARD: every static t() key resolves in EN + FR ----
interface ForwardFailure {
  file: string;
  key: string;
  line: number;
  missing: Locale[];
}
const forwardFailures: ForwardFailure[] = [];
for (const [key, loc] of staticKeys) {
  const missing = (['en', 'fr'] as const).filter((l) => typeof resolveKey(l, key) !== 'string');
  if (missing.length > 0) forwardFailures.push({ ...loc, key, missing });
}

if (forwardFailures.length > 0) {
  console.error(`\n✗ ${forwardFailures.length} unresolved t() key reference(s):\n`);
  for (const f of forwardFailures) {
    console.error(`  ${f.file}:${f.line}  ${f.key}  missing in: ${f.missing.join(',')}`);
  }
  console.error('');
}

// ---- REVERSE: every defined EN leaf key is referenced ----
const enLeaves = new Set<string>();
collectLeafKeys(messages.en, '', enLeaves);

const orphans: string[] = [];
for (const key of enLeaves) {
  if (keyishLiterals.has(key)) continue; // static t() key, key-map value, or config field
  if (coveredByPrefix(key)) continue; // dynamic composition family
  orphans.push(key);
}
orphans.sort();

if (orphans.length > 0) {
  console.error(
    `\n✗ ${orphans.length} orphaned i18n leaf key(s) — defined but never referenced:\n`,
  );
  for (const k of orphans) console.error(`  ${k}`);
  console.error(
    '\nEither remove them from BOTH messages.en and messages.fr in packages/i18n/src/index.ts,\n' +
      'or — if referenced via a variable-base dynamic composition the scan cannot see —\n' +
      'add the prefix to MANUAL_PREFIXES in this test.\n',
  );
}

assert.equal(
  forwardFailures.length,
  0,
  `${forwardFailures.length} unresolved t() key reference(s). Define the missing keys in packages/i18n/src/index.ts under BOTH messages.en and messages.fr.`,
);
assert.equal(
  orphans.length,
  0,
  `${orphans.length} orphaned i18n leaf key(s) defined but never referenced. Prune them from packages/i18n/src/index.ts (both locales) or whitelist a dynamic prefix.`,
);

console.log(
  `✓ ${staticKeys.size} static t() references resolve in EN + FR; ` +
    `all ${enLeaves.size} EN leaf keys are referenced ` +
    `(${totalFilesScanned} files scanned, ${autoPrefixes.size} dynamic prefixes).`,
);
