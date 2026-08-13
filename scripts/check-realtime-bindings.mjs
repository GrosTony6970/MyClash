/**
 * Every table a client subscribes to must be in the `supabase_realtime`
 * publication AND carry REPLICA IDENTITY FULL.
 *
 * ── Why this is a gate and not a runtime check ──────────────────────────────
 *
 * supabase-js compares the `postgres_changes` bindings it sent against the ones
 * the server accepted in the join reply. On a COUNT MISMATCH it calls
 * unsubscribe() and reports CHANNEL_ERROR — permanently, with no rejoin. So one
 * unpublished table does not degrade its own binding; it kills the ENTIRE
 * channel, including the three bindings that were fine.
 *
 * That is not hypothetical. `useLiveMatch` opened four bindings while only three
 * of those tables were published (0004_realtime.sql missed `match_penalties`),
 * and the public per-lice display — the one live surface with no polling
 * fallback — sat on "RECONNECTING…" for weeks. 0167_realtime_match_penalties.sql
 * fixed the data; this fixes the class.
 *
 * Offline by design: it reads source and migration text, never a database. The
 * operator wipes and redeploys from `packages/db/migrations`, so the migrations
 * ARE the deployed schema and a static check is the real protection.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { listMigrationFiles } from './lib/migrations.mjs';
import { toRepoPath, walkRepoFiles } from './lib/repo-scan.mjs';
import { stripSqlComments } from './lib/sql.mjs';

const root = process.cwd();
const migrationsDir = join(root, 'packages', 'db', 'migrations');

/** Only clients subscribe. The API talks to Postgres directly. */
const scanRoots = [
  join(root, 'apps', 'web-admin'),
  join(root, 'apps', 'web-public'),
  join(root, 'apps', 'web-staff'),
  join(root, 'packages', 'ui', 'src'),
];

const extensions = ['.ts', '.tsx'];

/**
 * The generic subscription hooks take `table` as a parameter, so their own
 * bodies read `table: opts.table`. Their CALL SITES are what this gate checks;
 * the definitions are exempt by path.
 */
const dynamicTableAllowlist = new Set([
  'apps/web-admin/src/lib/supabase-browser.ts',
  'apps/web-public/src/lib/supabase-browser.ts',
]);

/** Anchors that mean "a realtime binding is being declared here". */
const ANCHOR = /postgres_changes|useRealtimeWithFallback\s*\(/g;
/** How far past an anchor the `table:` property may sit. Real ones are <10 lines. */
const WINDOW = 600;

/**
 * `missingRoot: 'empty'` keeps the intent of the try/catch this replaces — a
 * scan root that does not exist yet is not a failure — and drops the half that
 * was never intended. That catch sat around EVERY level's readdir, not just the
 * root, so an unreadable subtree also returned [] and this gate passed having
 * scanned less. For a gate whose false green is a permanent CHANNEL_ERROR in
 * production, "unreadable" has to be loud; only "absent" is safe to read as
 * "no bindings here".
 */
function scanSources() {
  return scanRoots.flatMap((dir) => walkRepoFiles(dir, { missingRoot: 'empty', extensions }));
}

function lineOf(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

// ── 1. Collect the tables the clients bind to ────────────────────────────────

const boundTables = new Map(); // table -> [repoPath:line]
const dynamicBindings = [];

for (const file of scanSources()) {
  const repoPath = toRepoPath(file);
  const source = readFileSync(file, 'utf8');
  if (!source.includes('postgres_changes') && !source.includes('useRealtimeWithFallback')) continue;

  ANCHOR.lastIndex = 0;
  let anchor;
  while ((anchor = ANCHOR.exec(source)) !== null) {
    // The hook definition contains BOTH anchors; its call sites contain one.
    // Either way, look only at the text belonging to this anchor.
    const window = source.slice(anchor.index, anchor.index + WINDOW);
    const match = /\btable\s*:\s*(.+)/.exec(window);
    if (!match) continue;

    const value = match[1].trim();
    const literal = /^['"`]([a-z_][a-z0-9_]*)['"`]/.exec(value);
    const at = `${repoPath}:${lineOf(source, anchor.index + match.index)}`;

    if (literal) {
      const table = literal[1];
      if (!boundTables.has(table)) boundTables.set(table, []);
      boundTables.get(table).push(at);
    } else if (!dynamicTableAllowlist.has(repoPath)) {
      dynamicBindings.push(`${at}: table is not a string literal (${value.split('\n')[0]})`);
    }
  }
}

// ── 2. Collect what the migrations publish ───────────────────────────────────

// Comments are blanked, not read: 0167's own header quotes the statements it
// explains, and counting prose as DDL would make the gate pass on
// documentation. This used to strip `--` lines only, so a publication named
// inside a block comment still registered as published — see scripts/lib/sql.mjs.
const migrationSql = stripSqlComments(
  listMigrationFiles(migrationsDir)
    .map((name) => readFileSync(join(migrationsDir, name), 'utf8'))
    .join('\n'),
);

const published = new Set(
  [...migrationSql.matchAll(/ALTER\s+PUBLICATION\s+supabase_realtime\s+ADD\s+TABLE\s+(\w+)/gi)].map(
    (m) => m[1].toLowerCase(),
  ),
);
const replicaFull = new Set(
  [...migrationSql.matchAll(/ALTER\s+TABLE\s+(\w+)\s+REPLICA\s+IDENTITY\s+FULL/gi)].map((m) =>
    m[1].toLowerCase(),
  ),
);

// ── 3. Judge ─────────────────────────────────────────────────────────────────

const problems = [];

for (const [table, sites] of [...boundTables].sort()) {
  if (!published.has(table)) {
    problems.push(
      `'${table}' is subscribed to but never added to the supabase_realtime publication.\n` +
        `    A missing table kills the WHOLE channel (CHANNEL_ERROR, no rejoin), not just its own binding.\n` +
        `    Fix: a migration doing ALTER PUBLICATION supabase_realtime ADD TABLE ${table};\n` +
        `    Bound at: ${sites.join(', ')}`,
    );
  } else if (!replicaFull.has(table)) {
    problems.push(
      `'${table}' is published but has no REPLICA IDENTITY FULL.\n` +
        `    UPDATE/DELETE payloads then arrive without the old row, so a client cannot tell WHICH row changed.\n` +
        `    Fix: ALTER TABLE ${table} REPLICA IDENTITY FULL;\n` +
        `    Bound at: ${sites.join(', ')}`,
    );
  }
}

for (const dynamic of dynamicBindings) {
  problems.push(
    `${dynamic}\n` +
      `    A computed table name cannot be checked, so it could reach production unpublished.\n` +
      `    Fix: pass a literal, or add the file to dynamicTableAllowlist in this script with a reason.`,
  );
}

if (problems.length) {
  console.error('Realtime bindings are not backed by the publication:\n');
  for (const problem of problems) console.error(`  - ${problem}\n`);
  process.exit(1);
}

const unused = [...published].filter((table) => !boundTables.has(table)).sort();
console.log(
  `Realtime bindings OK: ${boundTables.size} subscribed table(s) ` +
    `(${[...boundTables.keys()].sort().join(', ')}) are all published with REPLICA IDENTITY FULL.`,
);
if (unused.length) {
  // Not a failure: publishing a table nothing subscribes to is harmless, and
  // is often a binding that is about to be written.
  console.log(`  Published but unused: ${unused.join(', ')}.`);
}
