/**
 * One component reads the match's events. Everyone else is handed the result.
 *
 * WHAT WENT WRONG. `usePenalties` fires three requests and `useExchanges` one,
 * and both re-run whenever `refreshKey` bumps — which is every scored hit. Four
 * components called them: `ScoringColumn` twice (it renders once per fighter),
 * `ScoringCenterControls`, and `MatchCorrectionsDrawer`. Fourteen requests per
 * hit, on the hall wifi this app exists to survive.
 *
 * The drawer is the instructive one. It LOOKS conditional — `MatchView` gates
 * it on `open` — and it is not: it is mounted unconditionally and its
 * `if (!open) return null` sits below the hooks, so a shut drawer fetched
 * exactly as hard as an open one. Nothing about reading that component
 * top-to-bottom suggests it. That is why this is a test and not a convention.
 *
 * WHAT IT CANNOT PROVE. That the one caller fetches efficiently, or that the
 * data is threaded correctly. It proves the whole-file omission — a fifth
 * component quietly reaching for the hook — which is the failure that actually
 * happened, four times, and is cheap enough to stay true.
 *
 * TYPE IMPORTS ARE FINE and must stay fine. `usePenalties` deliberately
 * re-exports `PenaltyCard`, `MatchPenalty` and `PenaltyRulesetEntry` so it
 * remains the import site consumers already use, and `black-card-loss.ts`,
 * `ScoringColumn` and the drawer all take types from it. Matching the MODULE
 * would red on all of them and force an exemption list, which is how a guard
 * dies. This matches the value import of the hook FUNCTION.
 *
 * The AST, not a regex: this file names every guarded hook in prose above, and
 * a text scan would flag itself.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const APP_ROOT = join(__dirname, '..', '..');

/**
 * Both trees. `src/` is where the components live, but the pad's route is
 * `app/matches/[matchId]/page.tsx` — the most natural home for the next caller,
 * and outside a walk that only covers `src/`.
 */
const SCANNED = ['src', 'app'];

/** Hooks that must have exactly one reader, the module each lives in, and who
 *  is allowed to read it. */
const SINGLE_READER = [
  { hook: 'usePenalties', module: 'usePenalties', owner: 'src/hooks/useMatchScoringData.ts' },
  { hook: 'useExchanges', module: 'useExchanges', owner: 'src/hooks/useMatchScoringData.ts' },
  // Same fault, different shape: `MatchView` and `MatchHeader` both called this
  // with the same arguments, so `/neighbors` was fetched twice per hit. It is
  // imported from `@myclash/ui`, so the owner here is the component, not a hook.
  {
    hook: 'useAdjacentMatches',
    module: '@myclash/ui',
    owner: 'src/components/MatchView.tsx',
  },
] as const;

function sourceFiles(dir: string, found: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!['node_modules', 'dist', '.next'].includes(entry)) sourceFiles(full, found);
      continue;
    }
    if (entry.endsWith('.ts') || entry.endsWith('.tsx')) found.push(full);
  }
  return found;
}

/**
 * Does this file import `hook` as a VALUE from the module that declares it?
 *
 * `import type { X }` and `import { type X }` are both skipped — they erase at
 * compile time and cannot call anything, and the hook module deliberately
 * re-exports several types.
 *
 * Scoped to the declaring module, so `import * as Sentry from '@sentry/nextjs'`
 * in `app/global-error.tsx` is not mistaken for a namespace grab at the hook.
 * A namespace import OF the hook module is flagged, because it can reach the
 * function and this cannot tell whether it does.
 */
function importsHookAsValue(source: ts.SourceFile, hook: string, moduleName: string): boolean {
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    // Exact for a package (`@myclash/ui`), last segment for a relative path
    // (`../hooks/usePenalties`). The last-segment test ALONE silently passed a
    // real `useAdjacentMatches` violation, because `'@myclash/ui'.split('/')`
    // ends in `ui` — a guard that cannot fail is worse than no guard, and the
    // only reason this was caught is that the falsification was actually run.
    if (specifier !== moduleName && specifier.split('/').pop() !== moduleName) continue;

    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) return true;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      if ((element.propertyName ?? element.name).text === hook) return true;
    }
  }
  return false;
}

describe('the pad reads its match events once', () => {
  const files = SCANNED.flatMap((dir) => sourceFiles(join(APP_ROOT, dir)));

  it('finds the files it is meant to be scanning', () => {
    // A walk that silently returns nothing would make every assertion below
    // pass. `MatchView` is the component this whole arrangement exists for.
    const repoPaths = files.map((f) => relative(APP_ROOT, f).split(sep).join('/'));
    expect(repoPaths).toContain('src/components/MatchView.tsx');
    expect(repoPaths).toContain('src/components/MatchCorrectionsDrawer.tsx');
    expect(repoPaths).toContain('app/matches/[matchId]/page.tsx');
  });

  for (const { hook, module, owner } of SINGLE_READER) {
    it(`only ${owner} calls ${hook}`, () => {
      const callers: string[] = [];
      for (const file of files) {
        const repoPath = relative(APP_ROOT, file).split(sep).join('/');
        if (repoPath === owner) continue;
        const source = ts.createSourceFile(
          repoPath,
          readFileSync(file, 'utf8'),
          ts.ScriptTarget.Latest,
          /* setParentNodes */ false,
          repoPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        );
        if (importsHookAsValue(source, hook, module)) callers.push(repoPath);
      }
      expect(callers, `${hook} must be read only by ${owner}`).toEqual([]);
    });
  }
});
