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
 * `{ manifests, modules }` — the workspaces whose `package.json` and whose
 * `node_modules` the runner stage copies out of an earlier stage.
 *
 * Returns empty sets when there is no runner stage, so a caller can tell
 * "nothing matched" from "no stage" by checking `manifests.size`.
 */
export function runnerStageWorkspaces(dockerfileText) {
  const start = dockerfileText.search(/^FROM\s.*\bAS runner\b/mu);
  if (start === -1) return { manifests: new Set(), modules: new Set(), hasRunnerStage: false };

  const runnerStage = dockerfileText.slice(start);
  return {
    manifests: copiedFromStage(runnerStage, String.raw`package\.json`),
    modules: copiedFromStage(runnerStage, 'node_modules'),
    hasRunnerStage: true,
  };
}
