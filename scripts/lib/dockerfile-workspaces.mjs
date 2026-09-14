/**
 * Which workspaces a Dockerfile's runner stage ships, read off its COPY lines.
 *
 * Extracted from `check-infra-review.mjs` so the parsing can be tested: the
 * gate itself is a top-level-await script that runs (and may `process.exit`) on
 * import, so nothing can import it to assert against.
 *
 * The regex is the fragile part, which is the part worth testing. It already
 * has one non-obvious job: the api runner copies four web-app `package.json`
 * files straight from the build context, as DATA for the version service. Those
 * are not part of the module tree. Requiring `--from=` is what separates them
 * from a workspace copied out of an earlier stage, which IS something Node
 * resolves through at runtime.
 */

/** Matches a workspace path under /app in a `COPY --from=` line. */
function copiedFromStage(runnerStage, suffix) {
  const found = new Set();
  const pattern = new RegExp(
    String.raw`^COPY\s+--from=[^\n]*?/app/((?:packages|apps)/[\w.-]+)/${suffix}\b`,
    'gmu',
  );
  for (const [, workspace] of runnerStage.matchAll(pattern)) found.add(workspace);
  return found;
}

/**
 * `{ manifests, modules, dists }` — the workspaces whose `package.json`, whose
 * `node_modules` and whose `dist` the runner stage copies out of an earlier
 * stage.
 *
 * Returns empty sets when there is no runner stage, so a caller can tell
 * "nothing matched" from "no stage" by checking `manifests.size`.
 */
export function runnerStageWorkspaces(dockerfileText) {
  const start = dockerfileText.search(/^FROM\s.*\bAS runner\b/mu);
  if (start === -1) {
    return { manifests: new Set(), modules: new Set(), dists: new Set(), hasRunnerStage: false };
  }

  const runnerStage = dockerfileText.slice(start);
  return {
    manifests: copiedFromStage(runnerStage, String.raw`package\.json`),
    modules: copiedFromStage(runnerStage, 'node_modules'),
    dists: copiedFromStage(runnerStage, 'dist'),
    hasRunnerStage: true,
  };
}

const WORKSPACE_SCOPE = '@myclash/';

/** `packages/<name>` for every `@myclash/<name>` runtime dependency of a manifest. */
function workspaceDependencies(manifest) {
  return Object.keys(manifest?.dependencies ?? {})
    .filter((name) => name.startsWith(WORKSPACE_SCOPE))
    .map((name) => `packages/${name.slice(WORKSPACE_SCOPE.length)}`);
}

/**
 * Every workspace package an app needs at runtime: its own `@myclash/*`
 * dependencies, their dependencies, and so on. Sorted.
 *
 * Transitive on purpose. `@myclash/types` needing `@myclash/rules` is the
 * outage that made these checks exist, and the api happening to list `rules`
 * itself is luck, not a guarantee.
 *
 * `@myclash/<name>` lives at `packages/<name>` — every workspace package in the
 * repo follows that. One that breaks it shows up as a manifest the caller cannot
 * read. `readManifest(workspace)` returns the parsed `package.json`, or null
 * when it could not be read (the caller has already reported it); the
 * workspace still counts as needed, only its own dependencies go unfollowed.
 */
export async function runtimeWorkspaces(appManifest, readManifest) {
  const needed = new Set();
  const queue = workspaceDependencies(appManifest);
  while (queue.length > 0) {
    const workspace = queue.pop();
    if (needed.has(workspace)) continue;
    needed.add(workspace);
    queue.push(...workspaceDependencies(await readManifest(workspace)));
  }
  return [...needed].sort();
}

/**
 * The runtime workspaces whose `package.json` or `dist` the runner stage does
 * not copy, each with what is missing.
 *
 * `node_modules` is deliberately not asked for here. It is needed only by a
 * package that has dependencies, and `check-infra-review.mjs` already demands
 * it for every manifest the runner ships — which this makes sure includes every
 * runtime workspace. One owner per rule.
 */
export function unshippedRuntimeFiles(dockerfileText, workspaces) {
  const { manifests, dists } = runnerStageWorkspaces(dockerfileText);
  const unshipped = [];
  for (const workspace of workspaces) {
    const missing = [];
    if (!manifests.has(workspace)) missing.push('package.json');
    if (!dists.has(workspace)) missing.push('dist');
    if (missing.length > 0) unshipped.push({ workspace, missing });
  }
  return unshipped;
}
