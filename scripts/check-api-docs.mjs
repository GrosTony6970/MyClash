import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

const violations = [];
const controllers = walkRepoFiles(controllerRoot).filter((path) => path.endsWith('.controller.ts'));
for (const controller of controllers) {
  const repoPath = toRepoPath(controller);
  const lines = readFileSync(controller, 'utf8').split(/\r?\n/);
  if (!lines.some((line) => line.includes('@ApiTags('))) {
    violations.push(`${repoPath}: missing @ApiTags`);
  }

  lines.forEach((line, index) => {
    if (!httpDecorator.test(line)) return;
    if (!hasApiOperation(lines, index)) {
      violations.push(`${repoPath}:${index + 1}: ${line.trim()} missing @ApiOperation`);
    }
  });
}

if (violations.length) {
  console.error('API documentation metadata gaps found:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log(`API documentation metadata covers ${controllers.length} controllers.`);
