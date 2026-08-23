/**
 * check-package-purity.mjs — the pad must be able to reach the competition core.
 *
 * ── The rule, and why prose was not enough ──────────────────────────────────
 * `docs/ARCHITECTURE.md` §7.3 states it plainly: "`@myclash/rulesets` is
 * deliberately NOT a dependency of `apps/web-staff` or `packages/ui`, and must
 * not become one." That sentence had no enforcement of any kind — no eslint
 * rule, no gate. The only thing that would ever have noticed is a bundle budget,
 * and only once the breach was already large enough to weigh.
 *
 * The consequence of a breach is not a slow bundle. It is a referee in a hall
 * with no network whose scoring pad will not start, because the engine it now
 * imports resolves a ruleset out of a database it cannot reach.
 *
 * ── Why `@myclash/rules` exists and what keeps it honest ────────────────────
 * The reason logic drifted into the wrong packages was never a design decision.
 * `packages/rulesets/src/match-format.ts` said so above its own duplicate copy
 * of the afterblow netting: kept local "so the ruleset engine stays
 * dependency-free (zod only) and isn't pulled into every app Dockerfile's
 * workspace build graph". That is a PACKAGE constraint, not a capability one.
 *
 * `@myclash/rules` removes it by having no dependencies at all. This gate is
 * what stops that claim rotting, and it is deliberately four separate rules —
 * each fails independently, and each is free.
 *
 * ── The risk the extraction itself created ─────────────────────────────────
 * Rules 1-3 guard the wall. Rule 4 exists because MOVING the wall opened a
 * different hole: the formula evaluator used to be unreachable from the pad by
 * accident of packaging, and now it is reachable on purpose. Nothing resolves a
 * ruleset there and "seed, don't resolve" still holds, but pad code could now
 * evaluate a custom ruleset's formula locally and print a real score — breaking
 * CLAUDE.md hard rule 1, where the server alone DERIVES a persisted score.
 *
 * So rule 4 reads the 7.3 allowlist table and holds the pad to it.
 *
 * ── Why the import rule is over the EMIT PROGRAM and not over src/ ──────────
 * Every colocated test in the package imports `vitest`. A rule spelled "nothing
 * under src/ imports outside itself" would therefore red on the package's own
 * tests from the day the package is created, and the obvious fix — carving out
 * `*.test.ts` by filename — is the glob mistake `check-test-code-leak.mjs`
 * argues against at length: `exclude` prunes the ROOT set, so a helper an
 * included file imports is pulled back in regardless of what it is called.
 *
 * The emit program is the honest set: exactly the files that end up in `dist`,
 * which is exactly what a consuming app resolves. `scripts/lib/emit-program.mjs`
 * asks the TypeScript compiler for it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { defineGate } from './lib/gate.mjs';
import { emitProgramFiles } from './lib/emit-program.mjs';
import { toRepoPath, walkRepoFiles } from './lib/repo-scan.mjs';

const root = process.cwd();

/** The package whose purity is the whole point. */
export const PURE_PACKAGE = 'packages/rules';

/**
 * Workspaces the scoring pad loads, which therefore must never reach the engine.
 * `packages/ui` is here because `apps/web-staff` depends on it, so a breach
 * there reaches the pad just as surely as a direct import would.
 */
export const PAD_REACHABLE = ['apps/web-staff', 'packages/ui'];

/** The package that must stay out of everything in PAD_REACHABLE. */
export const FORBIDDEN_ON_THE_PAD = '@myclash/rulesets';

/** Every pad surface imports this package freely, so what it re-exports lands
 *  on the pad as surely as a direct import would. */
export const RE_EXPORTER = 'packages/types';

const IMPORT_PATTERN = /(?:^|[^\w])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/gmu;
const BARE_IMPORT_PATTERN = /(?:^|[^\w])import\s*['"]([^'"]+)['"]/gmu;
const REQUIRE_PATTERN = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gmu;

/** Every module specifier in one source file. */
export function specifiersIn(source) {
  const found = [];
  for (const pattern of [IMPORT_PATTERN, BARE_IMPORT_PATTERN, REQUIRE_PATTERN]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) found.push(match[1]);
  }
  return found;
}

/**
 * Rule 1 — the manifest declares no runtime dependency.
 *
 * Read from the manifest rather than from `node_modules`, because the manifest
 * is what a Docker image installs from. `devDependencies` are deliberately not
 * checked: typescript and vitest never ship.
 */
export function findDeclaredDependencies(manifest) {
  const declared = Object.keys(manifest.dependencies ?? {});
  if (declared.length === 0) return [];
  return [
    `${PURE_PACKAGE}/package.json declares ${declared.length} runtime dependency/ies (${declared.join(', ')}) — this package must have none, or the scoring pad cannot import it offline`,
  ];
}

/**
 * Rule 2 — nothing in the emit program reaches outside the package.
 *
 * A relative specifier stays inside by construction. Anything else is a bare
 * specifier, which means a runtime dependency the manifest does not declare.
 */
export function findOutwardImports(files, read = readFileSync, label = toRepoPath) {
  const findings = [];
  for (const file of files) {
    for (const specifier of specifiersIn(read(file, 'utf8'))) {
      if (specifier.startsWith('.')) continue;
      findings.push(
        `${label(file)} imports "${specifier}" — ${PURE_PACKAGE} must reach nothing outside itself`,
      );
    }
  }
  return findings;
}

/**
 * Rule 3 — the engine stays off the pad.
 *
 * Both halves are checked because they fail independently: a manifest entry
 * with no import yet is a breach waiting to happen, and an import with no
 * manifest entry resolves anyway through the hoisted store and would ship.
 */
export function findEngineOnThePad(workspaces, read = readFileSync, label = toRepoPath) {
  const findings = [];
  let dirsWalked = 0;

  for (const workspace of workspaces) {
    const manifest = JSON.parse(read(join(root, workspace, 'package.json'), 'utf8'));
    const deps = { ...manifest.dependencies, ...manifest.devDependencies };
    if (FORBIDDEN_ON_THE_PAD in deps) {
      findings.push(
        `${workspace}/package.json declares ${FORBIDDEN_ON_THE_PAD} — ARCHITECTURE.md §7.3 forbids it: the pad must never need the engine`,
      );
    }

    for (const dir of ['src', 'app']) {
      // packages/ui has no app/. A missing directory is not a violation, but it
      // must not silently shrink the scan either -- dirsWalked is returned so
      // the caller can count it.
      const absolute = join(root, workspace, dir);
      if (!existsSync(absolute)) continue;
      dirsWalked += 1;
      for (const file of walkRepoFiles(absolute, { extensions: ['.ts', '.tsx'] })) {
        const specifiers = specifiersIn(read(file, 'utf8'));
        if (
          specifiers.some(
            (s) => s === FORBIDDEN_ON_THE_PAD || s.startsWith(`${FORBIDDEN_ON_THE_PAD}/`),
          )
        ) {
          findings.push(
            `${label(file)} imports ${FORBIDDEN_ON_THE_PAD} — ARCHITECTURE.md §7.3 forbids it: the pad must never need the engine`,
          );
        }
      }
    }
  }

  return { findings, dirsWalked };
}

/** Where the pad's allowlist is written down, in prose, today. */
export const ALLOWLIST_DOC = 'docs/ARCHITECTURE.md';
const ALLOWLIST_HEADING = '#### What arithmetic the pad IS allowed';

/**
 * Rule 4 — the pad may run only the arithmetic ARCHITECTURE.md 7.3 allows.
 *
 * ── The risk this closes, which the extraction itself created ───────────────
 * Before `@myclash/rules` existed, the formula evaluator was UNREACHABLE from
 * the scoring pad: it sat beside zod, and zod sat in a package the pad must not
 * import. That was an accident, but it was also a wall.
 *
 * Moving the evaluator into a zero-dependency package removed the wall. Nothing
 * resolves a ruleset on the pad and "seed, don't resolve" still holds — but pad
 * code could now evaluate a custom ruleset's formula locally and print a real
 * score. That breaks a different rule: CLAUDE.md hard rule 1, where the server
 * is the only thing that DERIVES a persisted score.
 *
 * ── Why the doc is the source and not a list in this file ──────────────────
 * 7.3 already carries the allowlist as a table, and
 * `packages/types/src/penalties.ts` argues the boundary at length. A second list
 * here would be a second owner, and the one that drifts is always the one
 * nobody reads. So this parses the table: the doc IS the gate, the way
 * check-docs-drift reads prose against the repo it describes.
 *
 * Type-only imports are ignored on purpose. A type erases at compile time and
 * ships nothing; the risk is a VALUE the pad can call.
 */
export function parseAllowlist(doc) {
  const start = doc.indexOf(ALLOWLIST_HEADING);
  if (start === -1) {
    throw new Error(
      `${ALLOWLIST_DOC}: cannot find "${ALLOWLIST_HEADING}" — the allowlist this gate reads is gone or renamed`,
    );
  }
  // Stop at the next heading of ANY level. Looking only for a deeper one runs
  // past `## 7bis` and swallows unrelated tables — referee roles and phase
  // types both parsed as pad permissions before this was pinned.
  const rest = doc.slice(start + ALLOWLIST_HEADING.length);
  const nextHeading = rest.search(/\n#{1,6} /u);
  const section = rest.slice(0, nextHeading === -1 ? undefined : nextHeading);

  const allowed = new Set();
  for (const line of section.split(/\r?\n/u)) {
    if (!line.startsWith('|') || /^\|\s*-+/u.test(line)) continue;
    const firstCell = line.split('|')[1] ?? '';
    for (const [, token] of firstCell.matchAll(/`([^`]+)`/gu)) {
      // Backticked package names are context, not permission.
      if (!token.includes('/') && /^[A-Za-z_$][\w$]*$/u.test(token)) allowed.add(token);
    }
  }

  if (allowed.size === 0) {
    throw new Error(
      `${ALLOWLIST_DOC}: the 7.3 allowlist table parsed to zero entries — a reword must not silently permit everything`,
    );
  }
  return allowed;
}

/**
 * Value bindings a source file takes from `@myclash/rules`.
 *
 * `import type {...}` and an inline `type X` are both dropped: neither reaches
 * the bundle, so neither can be called.
 */
export function valueBindingsFromRules(source) {
  const found = [];
  const pattern =
    /\b(?:import|export)\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]@myclash\/rules(?:\/[^'"]*)?['"]/gmu;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    if (match[1]) continue; // `import type { ... }` / `export type { ... }`
    for (const raw of match[2].split(',')) {
      const clause = raw.trim();
      if (!clause || clause.startsWith('type ')) continue;
      found.push(clause.split(/\s+as\s+/u)[0].trim());
    }
  }
  return found;
}

/**
 * Rule 4 over both routes a value can reach the pad: imported directly, or
 * re-exported by `@myclash/types`, which every pad surface imports freely.
 */
export function findUnallowedPadArithmetic(
  allowed,
  sources,
  read = readFileSync,
  label = toRepoPath,
) {
  const findings = [];
  let filesRead = 0;

  for (const file of sources) {
    filesRead += 1;
    for (const binding of valueBindingsFromRules(read(file, 'utf8'))) {
      if (allowed.has(binding)) continue;
      findings.push(
        `${label(file)} puts "${binding}" within reach of the scoring pad — ${ALLOWLIST_DOC} 7.3 lists what the pad may run, and this is not on it. Add a row with its reason, or keep the value off the pad's import path.`,
      );
    }
  }

  return { findings, filesRead };
}

/**
 * Every file from which a value could reach the pad: the pad-reachable
 * workspaces themselves, plus `@myclash/types`, which they all import freely and
 * which therefore re-exports straight onto the pad.
 */
export function padImportSurface(workspaces = [...PAD_REACHABLE, RE_EXPORTER]) {
  const files = [];
  for (const workspace of workspaces) {
    for (const dir of ['src', 'app']) {
      const absolute = join(root, workspace, dir);
      if (!existsSync(absolute)) continue;
      files.push(...walkRepoFiles(absolute, { extensions: ['.ts', '.tsx'] }));
    }
  }
  return files;
}

export function scanRepo(read = readFileSync) {
  const manifest = JSON.parse(read(join(root, PURE_PACKAGE, 'package.json'), 'utf8'));
  const emitFiles = emitProgramFiles(join(root, PURE_PACKAGE, 'tsconfig.build.json'), root);

  const pad = findEngineOnThePad(PAD_REACHABLE, read);
  const allowed = parseAllowlist(read(join(root, ALLOWLIST_DOC), 'utf8'));
  const arithmetic = findUnallowedPadArithmetic(allowed, padImportSurface(), read);

  const findings = [
    ...findDeclaredDependencies(manifest),
    ...findOutwardImports(emitFiles, read),
    ...pad.findings,
    ...arithmetic.findings,
  ];

  // The manifest rule, plus every emitted file the import rule opened, plus
  // every source directory the pad rule walked. Counting only the emitted files
  // would report a healthy number for a run in which rule 3 walked nothing --
  // which is exactly what a renamed app directory would cause.
  // The manifest rule, every emitted file the import rule opened, every source
  // directory the pad rule walked, every allowlist row parsed, and every file
  // rule 4 read. Counting only the emitted files would report a healthy number
  // for a run in which rules 3 and 4 walked nothing -- which is exactly what a
  // renamed app directory, or a reworded heading in ARCHITECTURE.md, would cause.
  const scanned = 1 + emitFiles.length + pad.dirsWalked + allowed.size + arithmetic.filesRead;

  return {
    findings,
    scanned,
    emitted: emitFiles.length,
    dirsWalked: pad.dirsWalked,
    allowed: allowed.size,
    padFilesRead: arithmetic.filesRead,
  };
}

export const gate = defineGate({
  name: 'Package purity',
  entry: import.meta.url,
  run: () => {
    const { findings, scanned, emitted, allowed } = scanRepo();
    return {
      findings,
      scanned,
      summary:
        `${PURE_PACKAGE} declares no runtime dependency and its ${emitted} emitted file(s) reach nothing outside it; ` +
        `${FORBIDDEN_ON_THE_PAD} is absent from ${PAD_REACHABLE.join(' and ')}; ` +
        `every value reaching the pad from ${PURE_PACKAGE} is one of the ${allowed} on the ${ALLOWLIST_DOC} §7.3 allowlist.`,
      remedy:
        `The scoring pad must work with no network (ARCHITECTURE.md §7.3, "Seed, don't resolve"). ` +
        `If ${PURE_PACKAGE} genuinely needs something, the thing it needs is not pure — move the caller out, not the dependency in.`,
    };
  },
});
