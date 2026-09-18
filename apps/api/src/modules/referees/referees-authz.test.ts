/**
 * The referee assignment board authorizes every route in the controller itself.
 *
 * On 2026-08-15 twenty routes across four controllers in this module had NO
 * authorization of any kind. Under the global `AuthGuard` they required *a*
 * logged-in account, but nothing tied that account to the event — so any
 * authenticated user could read any event's referee roster, and
 * `DELETE /events/:eventId/referee-assignments` would wipe it.
 *
 * The general rule this file first held, scoped to this module, moved to
 * `common/auth/route-authz.test.ts` on 2026-09-18: every controller, followed
 * into the services. What stays here is the board's own stricter rule.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const MODULE_DIR = join(__dirname);
const HTTP_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete']);

/** The board's handlers call an `assert…` helper themselves. */
const AUTHORIZES = /\bassert[A-Z]\w*\s*\(/;

interface Handler {
  file: string;
  name: string;
  text: string;
}

function decoratorName(decorator: ts.Decorator): string | null {
  const call = decorator.expression;
  if (!ts.isCallExpression(call)) return null;
  return ts.isIdentifier(call.expression) ? call.expression.text : null;
}

function handlersIn(file: string, source: string): Handler[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const handlers: Handler[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
      const decorators = ts.getDecorators(node) ?? [];
      const isRoute = decorators.some((d) => {
        const name = decoratorName(d);
        return name !== null && HTTP_DECORATORS.has(name);
      });
      if (isRoute) handlers.push({ file, name: node.name.text, text: node.getText(sourceFile) });
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  return handlers;
}

function allHandlers(): Handler[] {
  return readdirSync(MODULE_DIR)
    .filter((f) => f.endsWith('.controller.ts'))
    .flatMap((f) => handlersIn(f, readFileSync(join(MODULE_DIR, f), 'utf8')));
}

describe('referees module authorization', () => {
  it('finds the controllers, so an empty sweep cannot pass as a clean one', () => {
    const files = new Set(allHandlers().map((h) => h.file));

    expect(files.size).toBeGreaterThanOrEqual(4);
    expect(allHandlers().length).toBeGreaterThanOrEqual(20);
  });

  /**
   * The board is the one that mattered most: it both reads a roster of real
   * names and offers a route that deletes the whole thing.
   */
  it('authorizes every route on the assignment board directly', () => {
    const board = allHandlers().filter((h) => h.file === 'assignment-board.controller.ts');
    const withoutAssert = board.filter((h) => !AUTHORIZES.test(h.text)).map((h) => h.name);

    // The count is the point: it makes a NEW route a deliberate edit here
    // rather than something that slips in behind the API-wide rule.
    expect(board.length).toBe(12);
    expect(withoutAssert).toEqual([]);
  });
});
