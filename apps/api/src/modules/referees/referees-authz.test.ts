/**
 * Every HTTP handler in the referees module must let the caller's identity reach
 * a decision.
 *
 * On 2026-08-15 twenty routes across four controllers in this module had NO
 * authorization of any kind. Under the global `AuthGuard` they required *a*
 * logged-in account, but nothing tied that account to the event — so any
 * authenticated user could read any event's referee roster, and
 * `DELETE /events/:eventId/referee-assignments` would wipe it.
 *
 * None of the twenty touched the request object at all. That is the invariant
 * this asserts: a handler either calls an `assert…` helper itself, or resolves a
 * user id and hands it to a service that does. It cannot prove the service
 * really authorizes — but it makes "the identity never left the wire" a test
 * failure, and every one of the twenty failed exactly that way.
 *
 * Scoped to `modules/referees` on purpose. Widening it to the whole API is worth
 * doing and is a bigger job: some controllers legitimately serve public reads
 * behind `@Public()`, and this has no concept of that yet.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const MODULE_DIR = join(__dirname);
const HTTP_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete']);

/** A handler passes when identity reaches a decision by either route. */
const AUTHORIZES = /\bassert[A-Z]\w*\s*\(/;
const RESOLVES_IDENTITY = /\b(getUserId|resolveRequestUserId)\s*\(/;

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

  it('lets the caller identity reach a decision in every route', () => {
    const unguarded = allHandlers()
      .filter((h) => !AUTHORIZES.test(h.text) && !RESOLVES_IDENTITY.test(h.text))
      .map((h) => `${h.file} → ${h.name}`);

    expect(
      unguarded,
      `these handlers never look at who is calling:\n  ${unguarded.join('\n  ')}`,
    ).toEqual([]);
  });

  /**
   * The board is the one that mattered most: it both reads a roster of real
   * names and offers a route that deletes the whole thing.
   */
  it('authorizes every route on the assignment board directly', () => {
    const board = allHandlers().filter((h) => h.file === 'assignment-board.controller.ts');
    const withoutAssert = board.filter((h) => !AUTHORIZES.test(h.text)).map((h) => h.name);

    // The count is the point: it makes a NEW route a deliberate edit here
    // rather than something that slips in behind the loop above.
    expect(board.length).toBe(12);
    expect(withoutAssert).toEqual([]);
  });
});
