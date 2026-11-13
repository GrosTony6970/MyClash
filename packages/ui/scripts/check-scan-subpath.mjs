/**
 * The camera scanner stays behind `@myclash/ui/scan`.
 *
 * Run by `@myclash/ui`'s own build (it lives here, not in /scripts, because the web Dockerfiles copy only packages), right after tsc, because a vitest test cannot see
 * the dist it is part of (turbo's `^build` does not build the package's own dist first).
 * Two promises, both invisible to the typechecker:
 *   1. `dist/scan/decoder.js` still loads jsQR with a dynamic `import('jsqr')`. Compiled as
 *      `require` it would put ~13KB in every page of every app that reaches the subpath.
 *   2. `dist/index.js` (the root barrel, shipped to every app) never mentions the scanner.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Returns the list of broken promises; empty when the dist is as promised. */
export function checkUiScanSubpath(distDir) {
  const problems = [];
  const decoderPath = join(distDir, 'scan', 'decoder.js');
  const indexPath = join(distDir, 'index.js');
  if (!existsSync(decoderPath)) {
    problems.push(`${decoderPath} is missing: the build did not emit the scanner.`);
  } else if (!/\bimport\(\s*['"]jsqr['"]\s*\)/u.test(readFileSync(decoderPath, 'utf8'))) {
    problems.push(`${decoderPath} has no dynamic import('jsqr'): the decoder is no longer lazy.`);
  }
  if (!existsSync(indexPath)) {
    problems.push(`${indexPath} is missing.`);
  } else if (/scan/iu.test(readFileSync(indexPath, 'utf8'))) {
    problems.push(
      `${indexPath} mentions the scanner: it must only be reachable from @myclash/ui/scan.`,
    );
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = checkUiScanSubpath(join(process.cwd(), 'dist'));
  for (const problem of problems) console.error(problem);
  process.exit(problems.length === 0 ? 0 : 1);
}
