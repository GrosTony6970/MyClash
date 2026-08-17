/**
 * Gate: a package.json script must not name a file that is not there.
 *
 * ── The failure this closes ─────────────────────────────────────────────────
 * The root manifest carried `"seed": "tsx scripts/seed.ts"` for eighteen months.
 * scripts/seed.ts was never written — not deleted, never added — so `pnpm seed`
 * failed from the first commit that declared it. scripts/README.md documented
 * the same phantom plus a second one, and a doc review named all of it six weeks
 * before this was fixed. Written down and not gated is not fixed.
 *
 * ── Why a test and not a gate ───────────────────────────────────────────────
 * A new CI gate costs four registrations here — package.json, ci.yml, CI_GATES
 * in apps/api (the production image has no .github/ to read, so it carries the
 * expected list as a constant), and CONTRIBUTING.md — and gates.drift.test.ts
 * fails until all four exist. A test under scripts/ costs none, runs in CI under
 * the existing `pnpm test:scripts` step, and binds exactly as hard.
 *
 * ── Why TRACKED and not existsSync ──────────────────────────────────────────
 * Five targets are generated and absent from a fresh checkout (see
 * GENERATED_TARGETS). An existsSync rule passes on a developer's machine, where
 * the builds have run, and fails in CI, where they have not — the same
 * green-locally/red-in-CI split REPO_IGNORED_DIRS exists to prevent. Tracked is
 * the property that holds in every checkout, so tracked is the rule.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { isWalkablePath } from './lib/repo-scan.mjs';

/**
 * Targets that are written rather than committed. Each needs a reason: this is
 * the escape hatch, so it is also the thing most likely to be abused.
 */
export const GENERATED_TARGETS = {
  'openapi.json':
    'the output of `pnpm openapi:emit`, which boots dist/app.module to produce it. Committing it would make the drift gate compare the document against itself.',
  'packages/i18n/dist/index.test.js':
    'packages/i18n has no vitest config — its `test` script is `pnpm build && node dist/*.test.js`, so the COMPILED tests are the runner. See EXEMPT in check-test-code-leak.mjs.',
  'packages/i18n/dist/encoding.test.js': 'same as dist/index.test.js — compiled by its own build.',
  'packages/i18n/dist/no-literal-string-rule.test.js':
    'same as dist/index.test.js — compiled by its own build.',
  'packages/i18n/dist/t-key-references.test.js':
    'same as dist/index.test.js — compiled by its own build.',
};

/**
 * A token that names a repo file. Deliberately extension-anchored rather than
 * "anything with a slash": `--filter=@myclash/api` and `apps/api` are arguments,
 * not paths, and treating them as files is how this check would start lying.
 */
const PATH_LIKE = /^[\w./-]+\.(ts|mjs|cjs|js|json|sql)$/;

const gitLines = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 })
    .split('\0')
    .filter(Boolean);

const trackedFiles = () => gitLines('ls-files', '-z');

/**
 * Every script target, paired with the manifest that declares it.
 *
 * Resolved against the MANIFEST'S OWN DIRECTORY and nowhere else. pnpm runs a
 * script with the cwd set to its package, so `node scripts/x.mjs` in
 * packages/db means packages/db/scripts/x.mjs. A repo-root fallback would pass
 * that entry because a same-named file exists at the root — which is precisely
 * the break worth catching.
 */
function scriptTargets(manifests) {
  const targets = [];
  for (const manifest of manifests) {
    const dir = path.posix.dirname(manifest);
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
      for (const token of String(command).split(/\s+/)) {
        if (!PATH_LIKE.test(token)) continue;
        const resolved = dir === '.' ? token : path.posix.normalize(`${dir}/${token}`);
        targets.push({ manifest, name, token, resolved });
      }
    }
  }
  return targets;
}

const manifests = () =>
  trackedFiles()
    .filter((file) => path.posix.basename(file) === 'package.json')
    .filter(isWalkablePath);

test('every package.json script target resolves to a tracked file', () => {
  const tracked = new Set(trackedFiles());
  const broken = scriptTargets(manifests())
    .filter(({ resolved }) => !tracked.has(resolved) && !(resolved in GENERATED_TARGETS))
    // The token is what needs editing; the resolved path is added only when it
    // differs, which is exactly the `../..` case that is hardest to eyeball.
    .map(({ manifest, name, token, resolved }) =>
      token === resolved
        ? `${manifest} "${name}" -> ${token}`
        : `${manifest} "${name}" -> ${token} (resolves to ${resolved})`,
    );

  assert.deepEqual(
    broken,
    [],
    'these scripts name a file that is not tracked. Write the file, fix the path, or — if the target is generated — add it to GENERATED_TARGETS with a reason',
  );
});

// The rule above passes trivially if the extractor stops extracting. Two known
// targets from two different manifests prove it still reads both the root and a
// workspace. Named rather than counted: a numeric floor goes red every time
// somebody adds a script, which teaches people to bump the number.
test('the extractor still reaches the root manifest and a workspace one', () => {
  const resolved = new Set(scriptTargets(manifests()).map((target) => target.resolved));
  assert.ok(resolved.has('scripts/check-todos.mjs'), 'root manifest targets were not extracted');
  assert.ok(
    resolved.has('packages/db/scripts/migrate.mjs'),
    'workspace manifest targets were not extracted',
  );
});

test('manifest discovery reaches every workspace', () => {
  // Loose floor. Fifteen workspaces plus the root today; this catches discovery
  // breaking outright without churning when one is added.
  assert.ok(manifests().length >= 10, `only ${manifests().length} manifests discovered`);
});

test('every GENERATED_TARGETS entry carries a reason and is still needed', () => {
  const tracked = new Set(trackedFiles());
  for (const [target, reason] of Object.entries(GENERATED_TARGETS)) {
    assert.ok(reason.length > 30, `${target}: needs a real reason, not a placeholder`);
    // A generated target that becomes tracked no longer needs exempting, and a
    // stale exemption is a hole nobody remembers opening.
    assert.ok(!tracked.has(target), `${target} is tracked now — drop it from GENERATED_TARGETS`);
  }
});
