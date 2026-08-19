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
 *
 * ── What `scanned` does and does not protect ────────────────────────────────
 * `scanned` is the number of source files READ, which is what the harness's
 * empty-scan check needs: point this gate at absent roots and it used to print
 * "0 subscribed table(s)" and exit 0, forever. It does NOT notice a rule that
 * collapsed — break one character in ANCHOR and the count stays at ~1050 while
 * the binding set empties. check-realtime-bindings.test.mjs closes that from the
 * other side, by asserting the bindings the repo is known to have.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { defineGate } from './lib/gate.mjs';
import { listMigrationFiles } from './lib/migrations.mjs';
import { toRepoPath, walkRepoFiles } from './lib/repo-scan.mjs';
import { stripSqlComments } from './lib/sql.mjs';

const root = process.cwd();
const migrationsDir = join(root, 'packages', 'db', 'migrations');

/** Only clients subscribe. The API talks to Postgres directly. */
export const scanRoots = [
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
export const dynamicTableAllowlist = new Set([
  'apps/web-admin/src/lib/supabase-browser.ts',
  'apps/web-public/src/lib/supabase-browser.ts',
]);

/** Anchors that mean "a realtime binding is being declared here". */
const ANCHOR = 'postgres_changes|useRealtimeWithFallback\\s*\\(';
/** How far past an anchor the `table:` property may sit. Real ones are <10 lines. */
const WINDOW = 600;

/**
 * The walk, per root, so a caller can tell an empty root from an empty scan.
 *
 * `missingRoot: 'empty'` keeps the intent of the try/catch this replaces — a
 * scan root that does not exist yet is not a failure — and drops the half that
 * was never intended. That catch sat around EVERY level's readdir, not just the
 * root, so an unreadable subtree also returned [] and this gate passed having
 * scanned less. For a gate whose false green is a permanent CHANNEL_ERROR in
 * production, "unreadable" has to be loud; only "absent" is safe to read as
 * "no bindings here".
 *
 * That tolerance is why the result is keyed BY ROOT: renaming one of the four
 * leaves the total non-zero, so the harness's empty-scan check cannot see it.
 * The test asserts each root separately instead.
 */
export function scanSourcesByRoot(roots = scanRoots) {
  return new Map(
    roots.map((dir) => [dir, walkRepoFiles(dir, { missingRoot: 'empty', extensions })]),
  );
}

function lineOf(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

/**
 * The tables the clients bind to, and the bindings whose table cannot be read.
 *
 * `scanned` counts files READ, not files matched: every walked file is opened
 * and inspected, so a file with no binding is still a file this rule examined.
 */
export function collectBindings(files, read = readFileSync, label = toRepoPath) {
  const boundTables = new Map(); // table -> [repoPath:line]
  const dynamicBindings = [];
  let scanned = 0;

  for (const file of files) {
    const repoPath = label(file);
    const source = read(file, 'utf8');
    scanned += 1;
    if (!source.includes('postgres_changes') && !source.includes('useRealtimeWithFallback')) {
      continue;
    }

    // A fresh regex per file rather than a shared /g/ literal reset by hand,
    // which is what this replaced. Measured: the loop below runs until exec()
    // returns null, and THAT resets lastIndex to 0, so the old spelling could
    // not actually leak a position between files. This is protection against a
    // future `break` or early return, not a fix for a live bug — said plainly
    // because a comment claiming a bug it does not have is how the next reader
    // gets misled.
    const anchors = new RegExp(ANCHOR, 'g');
    let anchor;
    while ((anchor = anchors.exec(source)) !== null) {
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

  return { boundTables, dynamicBindings, scanned };
}

/**
 * What the migrations publish.
 *
 * Comments are blanked, not read: 0167's own header quotes the statements it
 * explains, and counting prose as DDL would make the gate pass on
 * documentation. This used to strip `--` lines only, so a publication named
 * inside a block comment still registered as published — see scripts/lib/sql.mjs.
 */
export function collectPublished(sql) {
  const published = new Set(
    [...sql.matchAll(/ALTER\s+PUBLICATION\s+supabase_realtime\s+ADD\s+TABLE\s+(\w+)/gi)].map(
      (match) => match[1].toLowerCase(),
    ),
  );
  const replicaFull = new Set(
    [...sql.matchAll(/ALTER\s+TABLE\s+(\w+)\s+REPLICA\s+IDENTITY\s+FULL/gi)].map((match) =>
      match[1].toLowerCase(),
    ),
  );
  return { published, replicaFull };
}

/** One finding per table that is bound but not backed, plus the unreadable ones. */
export function judge({ boundTables, dynamicBindings, published, replicaFull }) {
  const findings = [];

  for (const [table, sites] of [...boundTables].sort()) {
    if (!published.has(table)) {
      findings.push(
        `'${table}' is subscribed to but never added to the supabase_realtime publication.\n` +
          `    A missing table kills the WHOLE channel (CHANNEL_ERROR, no rejoin), not just its own binding.\n` +
          `    Fix: a migration doing ALTER PUBLICATION supabase_realtime ADD TABLE ${table};\n` +
          `    Bound at: ${sites.join(', ')}`,
      );
    } else if (!replicaFull.has(table)) {
      findings.push(
        `'${table}' is published but has no REPLICA IDENTITY FULL.\n` +
          `    UPDATE/DELETE payloads then arrive without the old row, so a client cannot tell WHICH row changed.\n` +
          `    Fix: ALTER TABLE ${table} REPLICA IDENTITY FULL;\n` +
          `    Bound at: ${sites.join(', ')}`,
      );
    }
  }

  for (const dynamic of dynamicBindings) {
    findings.push(
      `${dynamic}\n` +
        `    A computed table name cannot be checked, so it could reach production unpublished.\n` +
        `    Fix: pass a literal, or add the file to dynamicTableAllowlist in this script with a reason.`,
    );
  }

  return findings;
}

function readMigrationSql() {
  return stripSqlComments(
    listMigrationFiles(migrationsDir)
      .map((name) => readFileSync(join(migrationsDir, name), 'utf8'))
      .join('\n'),
  );
}

export const gate = defineGate({
  name: 'Realtime bindings',
  entry: import.meta.url,
  run: () => {
    const files = [...scanSourcesByRoot().values()].flat();
    const { boundTables, dynamicBindings, scanned } = collectBindings(files);
    const { published, replicaFull } = collectPublished(readMigrationSql());

    // Not a failure: publishing a table nothing subscribes to is harmless, and
    // is often a binding that is about to be written.
    const unused = [...published].filter((table) => !boundTables.has(table)).sort();
    const tables = [...boundTables.keys()].sort().join(', ');

    return {
      findings: judge({ boundTables, dynamicBindings, published, replicaFull }),
      scanned,
      summary:
        `Realtime bindings OK: ${boundTables.size} subscribed table(s) (${tables}) are all ` +
        `published with REPLICA IDENTITY FULL, across ${scanned} client source file(s).` +
        (unused.length ? `\n  Published but unused: ${unused.join(', ')}.` : ''),
      remedy:
        'A postgres_changes binding on an unpublished table does not degrade itself: supabase-js\n' +
        'compares sent bindings against accepted ones, and on a mismatch it unsubscribes the WHOLE\n' +
        'channel with a permanent CHANNEL_ERROR and no rejoin. Adding a table needs BOTH publication\n' +
        'membership and REPLICA IDENTITY FULL — see 0004_realtime.sql for the idempotent pattern.',
    };
  },
});
