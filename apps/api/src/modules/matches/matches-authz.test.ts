/**
 * Every HTTP handler in the matches module must let the caller's identity reach
 * a decision, unless it is declared public.
 *
 * The referees module was swept for this on 2026-08-15 and twenty routes were
 * found with no authorization of any kind. That sweep was scoped to
 * `modules/referees`, so it never looked here — and two routes in this
 * controller had exactly the same fault:
 *
 *   - `PUT /matches/:id/referee-role-assignments` named no event and checked
 *     nobody, so any signed-in account could put any person on any fight in any
 *     event. That is also the write path hard rule 8 has to hold, and it could
 *     not hold it without knowing who was asking.
 *   - `POST /phases/:phaseId/matches` said "(org admin+)" in its own summary and
 *     enforced nothing, the same shape `scheduleMatch` was fixed for earlier.
 *
 * Neither touched the request object at all. That is the invariant here: a
 * handler either calls an `assert…`/`authorize…` helper itself, or resolves a
 * user id and hands it to a service that does. It cannot prove the service
 * really authorizes — but it makes "the identity never left the wire" a test
 * failure, and both faults failed exactly that way.
 *
 * WHAT IS DIFFERENT FROM THE REFEREES SWEEP. This controller genuinely serves
 * public reads — a spectator watching a live bout needs the clock and the
 * exchanges with no account at all. Those carry `@Public()`, which is the
 * concept the referees test said it lacked. A handler is exempt only when it
 * says so out loud, so adding a route silently is not a way through.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const MODULE_DIR = join(__dirname);
const HTTP_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete']);

/** A handler passes when identity reaches a decision by either route. */
const AUTHORIZES = /\b(assert[A-Z]\w*|authorize[A-Z]\w*)\s*\(/;
const RESOLVES_IDENTITY = /\b(getUserId|resolveRequestUserId)\s*\(/;

interface Handler {
  file: string;
  name: string;
  text: string;
  isPublic: boolean;
}

function decoratorName(decorator: ts.Decorator): string | null {
  const call = decorator.expression;
  if (ts.isIdentifier(call)) return call.text;
  if (!ts.isCallExpression(call)) return null;
  return ts.isIdentifier(call.expression) ? call.expression.text : null;
}

function handlersIn(file: string, source: string): Handler[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const handlers: Handler[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
      const names = (ts.getDecorators(node) ?? [])
        .map(decoratorName)
        .filter((n): n is string => n !== null);
      if (names.some((n) => HTTP_DECORATORS.has(n))) {
        handlers.push({
          file,
          name: node.name.text,
          text: node.getText(sourceFile),
          isPublic: names.includes('Public'),
        });
      }
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

describe('matches module authorization', () => {
  it('finds the routes, so an empty sweep cannot pass as a clean one', () => {
    const handlers = allHandlers();
    expect(handlers.length).toBeGreaterThanOrEqual(25);
    // And it really can tell the two kinds apart, or the exemption below is
    // either exempting everything or nothing.
    expect(handlers.filter((h) => h.isPublic).length).toBeGreaterThan(0);
    expect(handlers.filter((h) => !h.isPublic).length).toBeGreaterThan(0);
  });

  it('lets no handler decide without knowing who is asking', () => {
    const offenders = allHandlers()
      .filter((h) => !h.isPublic)
      .filter((h) => !AUTHORIZES.test(h.text) && !RESOLVES_IDENTITY.test(h.text))
      .map((h) => `${h.file}#${h.name}`);

    expect(
      offenders,
      'these routes never let the caller identity reach a decision — they either ' +
        'need an authorize/assert helper, or a @Public() declaring the read open:\n  ' +
        offenders.join('\n  '),
    ).toEqual([]);
  });

  it('gates the per-match referee write on the event, not just on being logged in', () => {
    const handler = allHandlers().find((h) => h.name === 'setRefereeRoleAssignment');
    expect(handler, 'setRefereeRoleAssignment not found in the controller').toBeDefined();
    // Named specifically, not just "some helper": this route writes the crew of
    // one fight, and the organisation has to be resolved from the MATCH so a
    // caller cannot name someone else's event in the body.
    expect(handler!.text).toMatch(/authorizeMatchOrganizer\(req/);
  });

  it('creates a match under the phase in the path, and checks that phase', () => {
    const handler = allHandlers().find((h) => h.name === 'createMatch');
    expect(handler, 'createMatch not found in the controller').toBeDefined();
    expect(handler!.text).toMatch(/assertCanManagePhase\(/);
    // The body carries its own phaseId and the handler used to write THAT while
    // ignoring the path. Authorizing one and writing the other would be a hole
    // shaped exactly like the one being closed.
    expect(handler!.text).toMatch(/dto\.phaseId !== phaseId/);
  });
});
