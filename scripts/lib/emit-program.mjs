/**
 * The EMIT PROGRAM of a workspace: the files `tsc --project tsconfig.build.json`
 * will actually compile.
 *
 * ── Why a program and not a glob ────────────────────────────────────────────
 * `exclude` only prunes the ROOT set. A helper that an included file imports is
 * pulled back into the program and emitted with the exclusion still sitting in
 * the config looking correct. So the only honest answer comes from asking the
 * TypeScript compiler itself, which is what this does.
 *
 * ── Why it lives here ───────────────────────────────────────────────────────
 * `check-test-code-leak.mjs` worked this out first, for the rule that no test
 * code reaches a production image. `check-package-purity.mjs` needs the exact
 * same set for a different rule: nothing in `@myclash/rules`' emit program may
 * import outside the package. Two gates, one question — so the answer has one
 * owner, next to the other discovery primitives in `scripts/lib`.
 *
 * The distinction matters most for the purity gate. Its rule cannot be over
 * `src/`: every colocated test imports `vitest`, so a `src/`-wide rule would red
 * on the package's own tests from the day the package is created.
 */
import { resolve } from 'node:path';

import ts from 'typescript';

import { toRepoPath } from './repo-scan.mjs';

/**
 * Absolute paths of every file in `configPath`'s program.
 *
 * Throws rather than returning an empty list on a config it cannot read — an
 * unreadable tsconfig is a broken gate, and a gate that reports "0 files, all
 * clean" is the failure this whole harness exists to prevent.
 */
export function emitProgramFiles(configPath, root = process.cwd()) {
  const host = {
    useCaseSensitiveFileNames: false,
    readDirectory: ts.sys.readDirectory,
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    getCurrentDirectory: () => root,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, host);
  if (!parsed) throw new Error(`could not parse ${toRepoPath(configPath, root)}`);

  const errors = parsed.errors.filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) {
    const detail = errors
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
      .join('; ');
    throw new Error(`${toRepoPath(configPath, root)}: ${detail}`);
  }

  return parsed.fileNames.map((file) => resolve(file));
}
