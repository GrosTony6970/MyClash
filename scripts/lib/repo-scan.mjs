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
