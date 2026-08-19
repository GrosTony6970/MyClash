import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { defineGate } from './lib/gate.mjs';
import { toRepoPath, walkRepoFiles } from './lib/repo-scan.mjs';

const root = process.cwd();
const controllerRoot = join(root, 'apps', 'api', 'src', 'modules');
const httpDecorator = /^\s*@(Get|Post|Put|Patch|Delete)\(/;

function hasApiOperation(lines, decoratorIndex) {
  for (let i = decoratorIndex + 1; i < Math.min(lines.length, decoratorIndex + 40); i += 1) {
    const line = lines[i]?.trim() ?? '';
    if (line.startsWith('@ApiOperation(')) return true;
    if (/^(async\s+)?[\w$]+\s*\(/.test(line)) break;
  }

  for (let i = decoratorIndex - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim() ?? '';
    if (line === '') continue;
    if (line.startsWith('@ApiOperation(')) return true;
    if (line.startsWith('@') || line.startsWith('//')) continue;
    return false;
  }
  return false;
}

/** Every missing doc decorator in one controller. */
export function findApiDocGaps(source, repoPath) {
  const lines = source.split(/\r?\n/);
  const found = [];

  if (!lines.some((line) => line.includes('@ApiTags('))) {
    found.push(`${repoPath}: missing @ApiTags`);
  }

  lines.forEach((line, index) => {
    if (!httpDecorator.test(line)) return;
    if (!hasApiOperation(lines, index)) {
      found.push(`${repoPath}:${index + 1}: ${line.trim()} missing @ApiOperation`);
    }
  });

  return found;
}

/** The rule over a list of controllers, with the reader injected for the test. */
export function scanControllers(paths, read = readFileSync, label = toRepoPath) {
  return paths.flatMap((path) => findApiDocGaps(read(path, 'utf8'), label(path)));
}

export const gate = defineGate({
  name: 'API documentation metadata',
  entry: import.meta.url,
  run: () => {
    const controllers = walkRepoFiles(controllerRoot).filter((path) =>
      path.endsWith('.controller.ts'),
    );
    return {
      findings: scanControllers(controllers),
      scanned: controllers.length,
      summary: `API documentation metadata covers ${controllers.length} controllers.`,
      remedy:
        'Every controller needs @ApiTags and every HTTP route needs @ApiOperation. The OpenAPI\n' +
        'document is generated from these, so a missing one is a route the typed client cannot describe.',
    };
  },
});
