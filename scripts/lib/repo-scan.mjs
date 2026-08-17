import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Directory names no repo-root scan should descend into.
 *
 * ── Why this is shared rather than copied ───────────────────────────────────
 * check-complexity.mjs and check-todos.mjs both walk the repo root, so both
 * need the same exclusions. They used to keep private copies kept in step by
 * hand, under a comment in check-complexity.mjs reading "Mirrors the same
 * exclusions in scripts/check-todos.mjs".
 *
 * It did not. When the copies were merged here they had drifted in BOTH
 * directions: `_bmad` was excluded by complexity and not by todos, `.remember`
 * by todos and not by complexity. Neither omission was a decision — each entry
 * was added to whichever gate noticed the directory first.
 *
 * Neither drift was failing at the time, which is the point: every one of these
 * directories is gitignored or only partially tracked, so it exists on a
 * developer's machine and not in a CI checkout. A gate that scans one is red
 * locally and green in CI, and the disagreement is invisible until somebody
 * drops a large enough file into a tool cache.
 *
 * Adding an entry here applies it to every scan. That is the intent.
 */
export const REPO_IGNORED_DIRS = new Set([
  // Build output and package manager state.
  '.next',
  '.pnpm-store',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',

  // Test artefacts.
  'playwright-report',
  'test-results',

  '.git',

  // Agent and tool caches. Partially tracked, so gitignore does not cover them.
  // Their generated summaries discuss debt markers as prose, which is not debt
  // (spelling the markers out here would trip check-todos.mjs, which exempts
  // only itself), and .understand-anything's .trash-* subtree was contributing
  // complexity baseline entries for files nobody wrote.
  '.agents',
  '.claude',
  '.codex',
  '.kiro',
  '.remember',
  '.understand-anything',

  // Gitignored, vendored tooling — not product source, and not ours to hold to
  // a complexity budget.
  '_bmad',
]);

/** Explicit "descend into everything", so a call site reads as a decision. */
const NOTHING_IGNORED = new Set();

/**
 * ── Why the walk is shared, and what the eight copies actually disagreed on ──
 *
 * Eight gates each grew a private recursive `walk()`, because the ignore list
 * above was extracted without one and there was nothing to import. All eight
 * had diverged — different ignore lists, different missing-directory handling,
 * two different readdir APIs — which reads like eight deliberate behaviours.
 *
 * It was not. Every copy was run against its real scan roots and compared with
 * this implementation before the extraction:
 *
 *   api-docs 735=735 · bundle-budgets 65=65 · complexity 2681=2681 ·
 *   realtime-bindings 1008=1008 · test-code-leak 1411=1411 · todos 2681=2681 ·
 *   client-secret-boundaries 908→892 · shared-type-leaks 1395→1355
 *
 * — same files, in the same order, with one exception: the last two were also
 * reading the `.turbo` directory of every app and package. Those 56 entries are
 * turbo's own logs and tsbuildinfo, and BOTH gates filter by extension
 * afterwards, so neither could ever act on one. The divergence was accidental
 * in every case: each ignore list is whatever its author happened to trip over.
 *
 * ── Why two functions instead of one with an option ─────────────────────────
 * check-bundle-budgets.mjs weighs `apps/web-marketing/dist` and reads chunk
 * manifests out of `.next/server/app` — the exact directories REPO_IGNORED_DIRS
 * exists to exclude. A budget that inherited these exclusions would measure a
 * subset and pass, which is the failure that file's own docstring is a monument
 * to ("this budget spent its whole life measuring nothing"). Sharing one
 * function with a default ignore list makes that a one-word mistake; two named
 * functions make it a decision, and repo-scan.test.mjs pins which one it uses.
 *
 * ── Symlinks ────────────────────────────────────────────────────────────────
 * A Dirent describes the LINK, not its target, so `withFileTypes` alone would
 * silently drop a symlinked source file — seven of the eight copies used
 * statSync and followed it. The target is resolved instead, and a dangling link
 * is skipped rather than thrown on. No scanned tree holds a symlink today, so
 * this is a measured no-op; it is written down so it stays one on purpose.
 */
function scan(dir, ignoredDirs, extensions) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirs.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return scan(path, ignoredDirs, extensions);
    if (entry.isFile()) return matching(path, extensions);
    if (!entry.isSymbolicLink()) return []; // sockets, FIFOs, devices
    try {
      return statSync(path).isDirectory()
        ? scan(path, ignoredDirs, extensions)
        : matching(path, extensions);
    } catch {
      return []; // dangling link — the target is gone, not unreadable
    }
  });
}

function matching(path, extensions) {
  if (!extensions) return [path];
  return extensions.some((extension) => path.endsWith(extension)) ? [path] : [];
}

function walk(dir, ignoredDirs, { missingRoot = 'throw', extensions } = {}) {
  if (missingRoot !== 'throw' && missingRoot !== 'empty') {
    throw new Error(
      `walk: missingRoot must be "throw" or "empty", got ${JSON.stringify(missingRoot)}`,
    );
  }
  if (missingRoot === 'empty' && !existsSync(dir)) return [];
  return scan(dir, ignoredDirs, extensions);
}

/**
 * Every file under `dir`, skipping REPO_IGNORED_DIRS at any depth. For scans
 * over repo SOURCE.
 *
 * `missingRoot` defaults to `'throw'`: a scan root that has moved must be loud,
 * because the alternative is a gate reporting on nothing and passing. Pass
 * `'empty'` only where a root is legitimately optional — a workspace with no
 * `test/` directory, say. It guards the ROOT only; a subtree that cannot be
 * read still throws, because "unreadable" and "absent" are different answers
 * and only one of them is safe to treat as "no violations here".
 *
 * `extensions` is an optional suffix filter, applied as `endsWith`.
 */
export function walkRepoFiles(dir, options) {
  return walk(dir, REPO_IGNORED_DIRS, options);
}

/**
 * Every file under `dir`, skipping nothing. For scans over BUILD OUTPUT — the
 * directories walkRepoFiles exists to exclude.
 *
 * Same options. Use this only where the scan target is emitted rather than
 * written; anything reading repo source wants walkRepoFiles.
 */
export function walkAllFiles(dir, options) {
  return walk(dir, NOTHING_IGNORED, options);
}

/**
 * An absolute path as the repo spells it: relative to the root, forward slashes
 * on every platform.
 *
 * Every walking gate reports its violations this way and six of them had
 * written this exact line — five as `normalize`, one as `toRepoPath`. Unlike
 * the walks there was no drift to end here; it rides along because each of
 * those callers is already importing this module, and because a violation list
 * that spells paths differently per gate is a paper cut for whoever greps it.
 *
 * Named toRepoPath, not repoPath: five of the six assign the result to a local
 * `const repoPath`, which an import of that name would shadow.
 */
export function toRepoPath(absolute, root = process.cwd()) {
  return relative(root, absolute).split(sep).join('/');
}

/**
 * Whether a repo path is one the walks above would have reached.
 *
 * The string counterpart to walkRepoFiles: the walk applies REPO_IGNORED_DIRS by
 * skipping directories as it descends, this applies the same rule to a path that
 * arrived from somewhere else — in practice `git ls-files`, which is how a test
 * asks about TRACKED files rather than files on disk. Both answers must agree,
 * or a check reports on a set its own gate never reads.
 *
 * Here rather than in the callers for the reason this module exists at all: the
 * first copy of this predicate was a file-local const in one test, and a second
 * caller is exactly how the eight private walk() copies above began.
 */
export function isWalkablePath(repoPath) {
  return !repoPath.split('/').some((segment) => REPO_IGNORED_DIRS.has(segment));
}
