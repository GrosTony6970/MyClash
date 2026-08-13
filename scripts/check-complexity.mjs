/**
 * Complexity budget gate.
 *
 * Fails when a file over `fileLineLimit` lines, or a function over
 * `functionLineLimit` lines, appears outside
 * docs/code-quality-complexity-baseline.json. The baseline is a review ledger:
 * being in it means somebody looked and accepted it.
 *
 * ── Why this parses instead of counting braces ──────────────────────────────
 * This used to detect functions with a regex plus a running brace count over
 * raw text. That silently MISSED long functions, because it counted braces
 * inside strings, comments, template literals, regex literals and JSX. One `}`
 * in a string closes the frame early, the measured length collapses under the
 * limit, and the function vanishes from the report entirely — a false negative,
 * which is the worst failure mode a gate can have.
 *
 * Measured on this repo at the time of the rewrite: 133 named long functions in
 * apps/ and packages/ were invisible to the old detector, including a 342-line
 * listPublicParticipants and a 314-line populateBracket.
 *
 * TypeScript is already a repo dependency and gives exact node spans, so the
 * detector now asks the parser. Costs ~1.3s more on a full scan; irrelevant in
 * CI, and it is the difference between a gate that works and one that lies.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

import { walkRepoFiles } from './lib/repo-scan.mjs';

const root = process.cwd();
const baselinePath = join(root, 'docs', 'code-quality-complexity-baseline.json');

const fileLineLimit = 400;
const functionLineLimit = 50;
const scannedExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];

function normalize(path) {
  return relative(root, path).split(sep).join('/');
}

function countLines(source) {
  return source.split(/\r?\n/).length;
}

/**
 * The name to report a function under.
 *
 * Returns null for a genuinely anonymous function — an inline callback like
 * `.map(x => …)` or `useMemo(() => …)`. Those are deliberately NOT reported on
 * their own: their lines already count towards the named function they sit
 * inside, so flagging both would double-charge the same code and bury the
 * signal under hundreds of callbacks.
 */
function functionName(node) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isConstructorDeclaration(node)) return 'constructor';

  const parent = node.parent;
  if (!parent) return null;
  // const foo = () => {}   /   const foo = function () {}
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  // { foo: () => {} }
  if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  // class C { foo = () => {} }
  if (ts.isPropertyDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  // export default function () {}
  if (ts.isExportAssignment(parent)) return 'default';

  return null;
}

/** Enclosing class name, so a method reads as `PhasesService.populateBracket`. */
function enclosingClass(node) {
  for (let cursor = node.parent; cursor; cursor = cursor.parent) {
    if (ts.isClassDeclaration(cursor) || ts.isClassExpression(cursor)) {
      return cursor.name && ts.isIdentifier(cursor.name) ? cursor.name.text : 'class';
    }
  }
  return null;
}

function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isGetAccessor(node) ||
    ts.isSetAccessor(node) ||
    ts.isConstructorDeclaration(node)
  );
}

/**
 * Long functions in one source file.
 *
 * Exported for scripts/check-complexity.test.mjs — a gate with no test of its
 * own is how the brace-counting bug survived as long as it did.
 */
export function findFunctionHotspots(source, repoPath) {
  const scriptKind = repoPath.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : repoPath.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : undefined;
  const sourceFile = ts.createSourceFile(
    repoPath,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKind,
  );

  const hotspots = [];
  const visit = (node) => {
    if (isFunctionLike(node)) {
      const name = functionName(node);
      if (name) {
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
        const length = end - start + 1;
        if (length > functionLineLimit) {
          const owner = enclosingClass(node);
          const label = owner ? `${owner}.${name}` : name;
          hotspots.push({
            id: `${repoPath}:${start}`,
            sortKey: start,
            display: `${repoPath}:${start}: ${length} lines: ${label}`,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  // Source order, so the report reads top-to-bottom per file.
  return hotspots.sort((a, b) => a.sortKey - b.sortKey);
}

export function scanRepo() {
  const fileHotspots = [];
  const functionHotspots = [];
  for (const file of walkRepoFiles(root, { extensions: scannedExtensions })) {
    const repoPath = normalize(file);
    const source = readFileSync(file, 'utf8');
    const lines = countLines(source);
    if (lines > fileLineLimit) {
      fileHotspots.push({ id: repoPath, display: `${repoPath}: ${lines} lines` });
    }
    functionHotspots.push(...findFunctionHotspots(source, repoPath));
  }
  return { fileHotspots, functionHotspots };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
// Guarded so the test file can import the detector without running a scan.
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('check-complexity.mjs');
if (invokedDirectly) {
  const { fileHotspots, functionHotspots } = scanRepo();

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

  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const newFileHotspots = fileHotspots.filter((entry) => !baseline.files.includes(entry.id));
  const newFunctionHotspots = functionHotspots.filter(
    (entry) => !baseline.functions.includes(entry.id),
  );

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
}
