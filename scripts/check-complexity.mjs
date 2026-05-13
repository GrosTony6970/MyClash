import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = process.cwd();
const baselinePath = join(root, 'docs', 'code-quality-complexity-baseline.json');
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const ignoredDirs = new Set([
  '.agents',
  '.claude',
  '.codex',
  '.git',
  '.kiro',
  '.next',
  '.pnpm-store',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
]);
const fileLineLimit = 400;
const functionLineLimit = 50;
const scannedExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];
const controlKeywords = new Set(['catch', 'for', 'if', 'switch', 'while']);

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    if (ignoredDirs.has(entry)) return [];
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function normalize(path) {
  return relative(root, path).split(sep).join('/');
}

function hasScannedExtension(path) {
  return scannedExtensions.some((extension) => path.endsWith(extension));
}

function countLines(source) {
  return source.split(/\r?\n/).length;
}

function findFunctionHotspots(source, repoPath) {
  const lines = source.split(/\r?\n/);
  const hotspots = [];
  const stack = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const methodMatch =
      /^((private|protected|public)\s+)?(async\s+)?(?<name>[\w$]+)\s*\([^)]*\)\s*[:\w<>,\s|[\]]*\s*\{/.exec(
        trimmed,
      );
    const isFunctionStart =
      /\b(async\s+)?function\s+[\w$]+\s*\(/.test(line) ||
      (methodMatch?.groups?.name && !controlKeywords.has(methodMatch.groups.name)) ||
      /^\s*const\s+[\w$]+\s*=\s*(async\s*)?\([^)]*\)\s*=>\s*\{/.test(line);

    if (isFunctionStart) {
      stack.push({ start: index + 1, braceDepth: 0, name: line.trim().slice(0, 80) });
    }

    const openCount = (line.match(/\{/g) ?? []).length;
    const closeCount = (line.match(/\}/g) ?? []).length;
    for (const frame of stack) frame.braceDepth += openCount - closeCount;

    for (let i = stack.length - 1; i >= 0; i -= 1) {
      const frame = stack[i];
      if (frame && frame.braceDepth <= 0 && index + 1 > frame.start) {
        const length = index + 1 - frame.start + 1;
        if (length > functionLineLimit) {
          hotspots.push({
            id: `${repoPath}:${frame.start}`,
            display: `${repoPath}:${frame.start}: ${length} lines: ${frame.name}`,
          });
        }
        stack.splice(i, 1);
      }
    }
  });

  return hotspots;
}

const fileHotspots = [];
const functionHotspots = [];
for (const file of walk(root).filter(hasScannedExtension)) {
  const repoPath = normalize(file);
  const source = readFileSync(file, 'utf8');
  const lines = countLines(source);
  if (lines > fileLineLimit) {
    fileHotspots.push({ id: repoPath, display: `${repoPath}: ${lines} lines` });
  }
  functionHotspots.push(...findFunctionHotspots(source, repoPath));
}

if (process.argv.includes('--write-baseline')) {
  const nextBaseline = {
    files: fileHotspots.map((entry) => entry.id).sort(),
    functions: functionHotspots.map((entry) => entry.id).sort(),
  };
  writeFileSync(baselinePath, `${JSON.stringify(nextBaseline, null, 2)}\n`);
  console.log(
    `Wrote complexity baseline with ${nextBaseline.files.length} large files and ${nextBaseline.functions.length} long functions.`,
  );
  process.exit(0);
}

const newFileHotspots = fileHotspots.filter((entry) => !baseline.files.includes(entry.id));
const newFunctionHotspots = functionHotspots.filter((entry) => !baseline.functions.includes(entry.id));

if (newFileHotspots.length || newFunctionHotspots.length) {
  if (newFileHotspots.length) {
    console.error('New unreviewed large files:');
    for (const entry of newFileHotspots) console.error(`  - ${entry.display}`);
  }
  if (newFunctionHotspots.length) {
    console.error('New unreviewed long functions:');
    for (const entry of newFunctionHotspots) console.error(`  - ${entry.display}`);
  }
  process.exit(1);
}

console.log(
  `Complexity baseline covers ${fileHotspots.length} large files and ${functionHotspots.length} long functions.`,
);
