/**
 * Every route of the API that can change something, as the router knows it.
 *
 * Test-only (`common/event-readonly/archived-lock.routes.test.ts`), excluded from
 * the emit with the rest of `common/testing/`: it imports `typescript`.
 *
 * It reads the decorators, not a running app, so it sees a route whose module
 * nobody imports as well. `pattern` is what the router hands a guard for that
 * route (`request.routeOptions.url`): the global prefix, the controller's path
 * and the handler's, with every `:param` as written.
 */
import ts from 'typescript';
import { API_GLOBAL_PREFIX } from '../global-prefix';
import { decoratorName, pathArg, type SourceFile } from './route-authz-scan';

const WRITE_VERBS = new Set(['Post', 'Put', 'Patch', 'Delete', 'All']);
const CONTROLLER = new Set(['Controller']);

export interface WriteRoute {
  /** `PATCH tournaments/:id`: the verb and the path, as a reader says it. */
  key: string;
  method: string;
  pattern: string;
  /** The names the pattern binds, in order. */
  params: string[];
  /** `@AllowOnArchivedEvent()` on the handler or on its controller. */
  allowedOnArchived: boolean;
  /** `@BlockOnCompletedEvent()` on the handler or on its controller. */
  blockedOnCompleted: boolean;
}

const carries = (decorators: readonly ts.Decorator[], name: string): boolean =>
  decorators.some((d) => decoratorName(d) === name);

/** `pathArg`, which reads '' for a path it cannot read: here that would be a wrong pattern. */
function literalPath(decorators: readonly ts.Decorator[], names: ReadonlySet<string>): string {
  const call = decorators.find((d) => names.has(decoratorName(d) ?? ''))?.expression;
  const first = call && ts.isCallExpression(call) ? call.arguments[0] : undefined;
  if (first && !ts.isStringLiteral(first)) {
    throw new Error(`write-routes-scan reads string paths only: ${first.getText()}`);
  }
  return pathArg(decorators, names);
}

function routeOf(handler: ts.MethodDeclaration, outer: readonly ts.Decorator[]): WriteRoute | null {
  const own = ts.getDecorators(handler) ?? [];
  const verb = own.map(decoratorName).find((name) => name !== null && WRITE_VERBS.has(name));
  if (!verb) return null;
  const path = [literalPath(outer, CONTROLLER), literalPath(own, WRITE_VERBS)]
    .flatMap((part) => part.split('/'))
    .filter(Boolean)
    .join('/');
  const all = [...outer, ...own];
  return {
    key: `${verb.toUpperCase()} ${path}`,
    method: verb.toUpperCase(),
    pattern: `/${API_GLOBAL_PREFIX}/${path}`,
    params: path
      .split('/')
      .filter((part) => part.startsWith(':'))
      .map((part) => part.slice(1)),
    allowedOnArchived: carries(all, 'AllowOnArchivedEvent'),
    blockedOnCompleted: carries(all, 'BlockOnCompletedEvent'),
  };
}

export function scanWriteRoutes(sources: readonly SourceFile[]): WriteRoute[] {
  const routes: WriteRoute[] = [];
  for (const source of sources) {
    if (!source.path.endsWith('.controller.ts')) continue;
    const sf = ts.createSourceFile(source.path, source.text, ts.ScriptTarget.Latest, true);
    for (const st of sf.statements) {
      if (!ts.isClassDeclaration(st)) continue;
      const outer = ts.getDecorators(st) ?? [];
      if (!carries(outer, 'Controller')) continue;
      for (const member of st.members) {
        const route = ts.isMethodDeclaration(member) ? routeOf(member, outer) : null;
        if (route) routes.push(route);
      }
    }
  }
  return routes.sort((a, b) => a.key.localeCompare(b.key));
}
