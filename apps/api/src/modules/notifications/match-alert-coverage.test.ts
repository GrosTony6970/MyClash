/**
 * Every write of `matches.scheduled_at` OR `matches.lice_id` must refresh the
 * alerts built from them.
 *
 * A queued "your fight starts in 10 minutes" is built from two fields, not one:
 * the time it fires at, and the piste it names in its own sentence — "… fights
 * in 10 min — Pool 3 vs Dupont on Piste 2". Both are frozen into the job body
 * when it is enqueued.
 *
 * Move the fight in the clock and the job stays where it was; it fires at the
 * old minute for a fight that is now somewhere else. That half was closed on
 * 2026-08-15, when NINE writes of the time across four services turned out to
 * have exactly one caller telling the queue anything — and that one got it half
 * right, so nothing looked broken.
 *
 * Move the fight between PISTES and nothing fires at the wrong moment at all:
 * the alert arrives on time and names a piste the fight has left. That is why
 * this half went unnoticed for longer. Three writes changed `lice_id` without
 * touching `scheduled_at`, so the refresher never ran and the guard below could
 * not see them — it was watching one field of the two the body depends on.
 *
 * Eight, then three, silent instances of one bug is not eleven oversights: it is
 * a missing seam. `MatchAlertRefresherService` is the seam and this is what
 * keeps the next write from being written without it.
 *
 * WHAT IT CANNOT PROVE. This asserts the file REFERENCES the refresher, not
 * that the reference sits on the right code path. A file could call it once and
 * add a second write that skips it. Making "the identity reached a decision" a
 * test failure is the same bar `referees-authz.test.ts` settled on, for the
 * same reason: it catches the whole-file omission, which is the failure that
 * actually happened, and it is cheap enough to be true forever.
 *
 * The detector walks the TypeScript AST rather than matching text in a window.
 * A window is what let the bulk generation upsert hide for the whole recon: its
 * `scheduled_at` sits five lines ABOVE the `.from('matches')` that writes it,
 * in a payload built earlier.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const API_SRC = join(__dirname, '..', '..');
const REFRESHER = 'MatchAlertRefresher';

/**
 * Files allowed to write a match time without refreshing.
 *
 * Empty, and meant to stay that way. A new entry needs a reason in this comment
 * saying why the alerts cannot be wrong — not "this path is rare".
 */
const EXEMPT: string[] = [];

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules' && entry !== 'dist') sourceFiles(full, found);
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) found.push(full);
  }
  return found;
}

/** The `.from('matches')` calls in a file, as AST nodes. */
function matchTableCalls(source: ts.SourceFile): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'from' &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]!) &&
      (node.arguments[0] as ts.StringLiteralLike).text === 'matches'
    ) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}

/** The outermost node of the fluent chain hanging off a `.from('matches')`. */
function chainRoot(call: ts.CallExpression): ts.Node {
  let node: ts.Node = call;
  while (
    node.parent &&
    (ts.isPropertyAccessExpression(node.parent) || ts.isCallExpression(node.parent))
  ) {
    node = node.parent;
  }
  return node;
}

/** The first argument of the chain's `.update(…)` / `.upsert(…)`, if it has one. */
function writePayload(root: ts.Node): ts.Expression | null {
  let found: ts.Expression | null = null;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === 'update' || node.expression.name.text === 'upsert') &&
      node.arguments.length > 0
    ) {
      found ??= node.arguments[0]!;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

/**
 * The two columns an alert body is built from. A write of EITHER can leave a
 * queued job describing something that is no longer true.
 */
const ALERT_COLUMNS = ['scheduled_at', 'lice_id'] as const;

/**
 * Does this payload set one of the alert columns?
 *
 * A literal answers for itself. An IDENTIFIER does not, and that is not an edge
 * case — the schedule generator builds `matchesPayload` twenty lines earlier
 * and hands it over by name, which is how that write stayed invisible through a
 * whole recon pass. So a named payload is resolved to its declaration.
 *
 * Resolving beats falling back to the file, and the reason is now visible in
 * both directions. A file-wide text search was the first attempt and it flagged
 * `venues.service.ts` for merely mentioning `scheduled_at:` in a TYPE
 * ANNOTATION — a guard that cries wolf gets an exemption entry, and an
 * exemption list is how a guard dies. That same file is flagged today, for the
 * opposite and correct reason: it really does write `lice_id`.
 */
function payloadSetsAlertColumn(payload: ts.Expression, source: ts.SourceFile): boolean {
  const mentionsColumn = (text: string): boolean =>
    ALERT_COLUMNS.some((column) => text.includes(column));

  if (mentionsColumn(payload.getText(source))) return true;
  if (!ts.isIdentifier(payload)) return false;
  const name = payload.text;
  let declared = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      mentionsColumn(node.initializer?.getText(source) ?? '')
    ) {
      declared = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return declared;
}

function alertWriteFiles(): string[] {
  const files: string[] = [];
  for (const file of sourceFiles(API_SRC)) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes("from('matches')")) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    for (const call of matchTableCalls(source)) {
      const payload = writePayload(chainRoot(call));
      if (!payload || !payloadSetsAlertColumn(payload, source)) continue;
      files.push(file.replace(/\\/g, '/'));
      break;
    }
  }
  return files;
}

describe('match alert coverage', () => {
  /**
   * The detector has to actually see the five services it was built for, or
   * every assertion below passes by finding nothing. A guard that has silently
   * stopped detecting is worse than no guard: it reads as coverage.
   */
  it('finds the writes it is meant to police', () => {
    const files = alertWriteFiles();
    expect(files.some((f) => f.endsWith('programme/programme.service.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('matches/matches.service.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('phases/phases.service.ts'))).toBe(true);
    expect(
      files.some((f) => f.endsWith('organizer-ai-assistant/organizer-ai-assistant.service.ts')),
    ).toBe(true);
    // The piste half. This file writes `lice_id` and NOTHING else, so it is the
    // one that proves the guard widened — under the time-only detector it was
    // asserted ABSENT, and a piste-only move is exactly the write that used to
    // slip through.
    expect(files.some((f) => f.endsWith('venues/venues.service.ts'))).toBe(true);
  });

  /**
   * And nothing that merely reads the columns, or names them in a type. The
   * detector walks the AST for a `.update()`/`.upsert()` payload precisely so a
   * mention is not a write — the first version of this guard flagged
   * `venues.service.ts` off a type annotation and would have earned an
   * exemption entry for it.
   */
  it('does not flag a file that only reads the alert columns', () => {
    const files = alertWriteFiles();
    expect(files.some((f) => f.endsWith('events/event-readiness.ts'))).toBe(false);
    expect(files.some((f) => f.endsWith('matches/referee-assignment-index.ts'))).toBe(false);
  });

  it('leaves no write of a match time or piste without a refresh', () => {
    const offenders = Array.from(new Set(alertWriteFiles()))
      .filter((file) => !EXEMPT.some((allowed) => file.endsWith(allowed)))
      .filter((file) => !readFileSync(file, 'utf8').includes(REFRESHER))
      .map((file) => file.slice(file.indexOf('apps/api/')));

    expect(
      offenders,
      'these files write a match time or piste and never refresh its alerts:\n  ' +
        offenders.join('\n  '),
    ).toEqual([]);
  });
});
