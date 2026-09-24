/**
 * Static reading of every HTTP handler: can anything reachable from it REFUSE
 * the caller?
 *
 * Test-only (`route-authz.test.ts`), excluded from the emit with the rest of
 * `common/testing/`: it imports `typescript`, which the production image lacks.
 *
 * WHY IT FOLLOWS CALLS INTO SERVICES. The module tests before it passed a
 * handler as soon as it resolved the caller's id. That passed `createPerson`,
 * which resolved the id only to stamp `created_by_user_id`, and eight Swiss
 * writes that resolved it only for the audit log and accepted a null. So a handler
 * passes here only when a REFUSER is reachable: in the handler, in a same-class
 * method or same-file function, in a method of an injected service, or in an
 * imported function — followed through the real import, up to MAX_HOPS away.
 *
 * A refuser throws when the caller may not proceed. Only the REFUSERS below are
 * counted, by name; every wrapper around them (`assertCanManageEvent`, the
 * scoring authorizers) is FOLLOWED down to one.
 * Things that merely look — `resolvePersonId` returns null, `isPlatformStaff`
 * returns a flag, a query filtered on some `user_id` may filter on an id from
 * the URL — are not decisions. `assertCanRead*` is not followed: it lets anyone
 * through once an Event is published, so a route that has nothing else is an
 * open read and says so with `@Public()`.
 *
 * A helper the scan cannot follow gives a false alarm, which lands in the
 * reviewed exemptions. It reads REACHABILITY, not paths, so it passes a route
 * whose refuser: guards one branch only (a check inside one `if`, the other
 * path checking nobody); is caught and swallowed; sits behind an `@Optional()`
 * dependency; or checks the wrong thing (an org role on an Event the caller
 * named). A `me` route passes on its path, so one that reads other people's rows
 * passes too. And `requirePersonId` accepts any self-picked guest. The ledger's
 * FALSE_PASSES holds the cases a reading found; behaviour tests own the rest.
 * Comments are stripped before matching.
 */
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';
import { apiSourceFiles } from './supabase-query-scan';

export type RouteVerdict = 'public' | 'platform-guard' | 'decides' | 'self' | 'undecided';

export interface RouteHandler {
  /** `modules/x/x.controller.ts#XController.method`, relative to the scanned root. */
  key: string;
  verdict: RouteVerdict;
}

export interface SourceFile {
  /** Absolute path, forward slashes. */
  path: string;
  text: string;
}

const HTTP = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Head', 'Options']);
const MAX_HOPS = 4;

/**
 * Throws unless the caller may proceed: org role (in one club, or in any club),
 * platform tier, staff or participant session — then three module-private checks, each read: league
 * admin, compensation org admin, fighter-profile owner. The test holds each to
 * ONE definition, so a namesake that only looks cannot pass. A reachable 403 is
 * NOT enough: many say "Built-in plans cannot be modified".
 */
export const REFUSERS = [
  'assertOrgRole',
  'assertAnyOrgRole',
  'assertPlatformTier',
  'requireStaffFromRequest',
  'requireStaffWithRole',
  'requirePersonId',
  'assertCanManageLeague',
  'requireOrgAdmin',
  'assertFighterOwner',
] as const;

const REFUSER = new RegExp(`\\b(${REFUSERS.join('|')})\\s*\\(`);

/**
 * A `me` route acts on the caller's own rows, so refusing an anonymous caller IS
 * its decision. Anywhere else the same refusal only authenticates: it is the
 * shape `createPerson` had, and stays undecided.
 */
const AUTHENTICATES = /\bthrow new UnauthorizedException\b/;

/** Never followed: they let anyone through a published Event. */
const PUBLIC_READ_GATES = new Set([
  'assertCanReadEvent',
  'assertCanReadEventRow',
  'assertCanReadPhase',
  // competition-visibility.ts: the same shape, for bouts and Tournaments.
  'canReadEvent',
  'canReadMatch',
  'canReadTournament',
  'matchVisibility',
  'isInsider',
  'seesHiddenOnLice',
]);

const printer = ts.createPrinter({ removeComments: true });

interface ClassInfo {
  name: string;
  members: Map<string, ts.Node>;
  /** Injected field name → the class it holds, as written. */
  fields: Map<string, string>;
}

interface FileInfo {
  sf: ts.SourceFile;
  classes: Map<string, ClassInfo>;
  functions: Map<string, ts.Node>;
  /** Imported name → absolute path of the module it comes from. */
  imports: Map<string, string>;
}

/** Key → the fewest hops it was reached at; a shorter path is followed again. */
type Seen = Map<string, number>;

type Reach = (
  node: ts.Node,
  file: string,
  cls: ClassInfo | null,
  hops: number,
  seen: Seen,
) => string;

function decoratorName(decorator: ts.Decorator): string | null {
  const call = decorator.expression;
  if (ts.isIdentifier(call)) return call.text;
  if (ts.isCallExpression(call) && ts.isIdentifier(call.expression)) return call.expression.text;
  return null;
}

/** Resolved against the scanned set, not the disk, so a test can scan sources it made up. */
function resolveImport(from: string, spec: string, known: ReadonlySet<string>): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec).replace(/\\/g, '/');
  return [`${base}.ts`, `${base}/index.ts`].find((candidate) => known.has(candidate)) ?? null;
}

function indexFile(source: SourceFile, known: ReadonlySet<string>): FileInfo {
  const sf = ts.createSourceFile(source.path, source.text, ts.ScriptTarget.Latest, true);
  const info: FileInfo = { sf, classes: new Map(), functions: new Map(), imports: new Map() };
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const target = resolveImport(source.path, st.moduleSpecifier.text, known);
      const named = st.importClause?.namedBindings;
      if (target && named && ts.isNamedImports(named)) {
        for (const el of named.elements) info.imports.set(el.name.text, target);
      }
    }
    if (ts.isFunctionDeclaration(st) && st.name) info.functions.set(st.name.text, st);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const init = d.initializer;
        const fn = init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
        if (ts.isIdentifier(d.name) && fn) info.functions.set(d.name.text, d);
      }
    }
    if (ts.isClassDeclaration(st) && st.name) info.classes.set(st.name.text, indexClass(st));
  }
  return info;
}

function indexClass(node: ts.ClassDeclaration): ClassInfo {
  const members = new Map<string, ts.Node>();
  const fields = new Map<string, string>();
  for (const m of node.members) {
    if ((ts.isMethodDeclaration(m) || ts.isGetAccessor(m)) && ts.isIdentifier(m.name)) {
      members.set(m.name.text, m);
    }
    if (ts.isConstructorDeclaration(m)) {
      for (const p of m.parameters) {
        if (ts.isIdentifier(p.name) && p.type && ts.isTypeReferenceNode(p.type)) {
          fields.set(p.name.text, p.type.typeName.getText());
        }
      }
    }
  }
  return { name: node.name?.text ?? '', members, fields };
}

/** Every body reachable from a node, comments stripped, concatenated. */
function reacher(files: ReadonlyMap<string, FileInfo>): Reach {
  const reach: Reach = (node, file, cls, hops, seen) => {
    const info = files.get(file);
    if (!info) return '';
    const own = printer.printNode(ts.EmitHint.Unspecified, node, info.sf);
    let acc = own;
    const follow = (key: string, at: number, body: () => string): void => {
      if ((seen.get(key) ?? Infinity) <= at) return;
      seen.set(key, at);
      acc += '\n' + body();
    };
    for (const [, field, method] of own.matchAll(/\bthis\.(\w+)\.(\w+)\s*\(/g)) {
      const type = cls?.fields.get(field!);
      const target = type ? info.imports.get(type) : undefined;
      const service = target ? files.get(target)?.classes.get(type!) : undefined;
      const body = service?.members.get(method!);
      if (service && body && hops < MAX_HOPS && !PUBLIC_READ_GATES.has(method!)) {
        const at = hops + 1;
        follow(`${target}#${type}.${method}`, at, () => reach(body, target!, service, at, seen));
      }
    }
    for (const [, name] of own.matchAll(/\bthis\.(\w+)\b(?!\.)/g)) {
      const body = cls?.members.get(name!);
      if (body)
        follow(`${file}#${cls!.name}.${name}`, hops, () => reach(body, file, cls, hops, seen));
    }
    for (const [, name] of own.matchAll(/\b(\w+)\s*\(/g)) {
      if (PUBLIC_READ_GATES.has(name!)) continue;
      const local = info.functions.get(name!);
      const from = info.imports.get(name!);
      const foreign = from ? files.get(from)?.functions.get(name!) : undefined;
      if (local) follow(`${file}::${name}`, hops, () => reach(local, file, cls, hops, seen));
      else if (foreign && hops < MAX_HOPS) {
        follow(`${from}::${name}`, hops + 1, () => reach(foreign, from!, null, hops + 1, seen));
      }
    }
    return acc;
  };
  return reach;
}

const guardedByPlatformRole = (decorators: readonly ts.Decorator[]): boolean =>
  decorators.some(
    (d) => decoratorName(d) === 'UseGuards' && /\bPlatformRoleGuard\b/.test(d.getText()),
  );

/** The first string argument of the first decorator named in `names`, or ''. */
function pathArg(decorators: readonly ts.Decorator[], names: ReadonlySet<string>): string {
  const call = decorators.find((d) => names.has(decoratorName(d) ?? ''))?.expression;
  const first = call && ts.isCallExpression(call) ? call.arguments[0] : undefined;
  return first && ts.isStringLiteral(first) ? first.text : '';
}

function verdictOf(
  handler: ts.MethodDeclaration,
  owner: ts.ClassDeclaration,
  body: () => string,
): RouteVerdict {
  const own = ts.getDecorators(handler) ?? [];
  const outer = ts.getDecorators(owner) ?? [];
  if ([...outer, ...own].some((d) => decoratorName(d) === 'Public')) return 'public';
  if (guardedByPlatformRole(outer) || guardedByPlatformRole(own)) return 'platform-guard';
  const text = body();
  if (REFUSER.test(text)) return 'decides';
  const path = `${pathArg(outer, new Set(['Controller']))}/${pathArg(own, HTTP)}`;
  const self = path.split('/').includes('me');
  return self && AUTHENTICATES.test(text) ? 'self' : 'undecided';
}

export function scanRoutes(sources: readonly SourceFile[], root: string): RouteHandler[] {
  const known = new Set(sources.map((s) => s.path));
  const files = new Map(sources.map((s) => [s.path, indexFile(s, known)]));
  const reach = reacher(files);
  const handlers: RouteHandler[] = [];
  for (const [path, info] of files) {
    if (!path.endsWith('.controller.ts')) continue;
    const where = relative(root, path).replace(/\\/g, '/');
    for (const st of info.sf.statements) {
      if (!ts.isClassDeclaration(st) || !st.name) continue;
      const cls = info.classes.get(st.name.text)!;
      for (const m of st.members) {
        if (!ts.isMethodDeclaration(m) || !ts.isIdentifier(m.name)) continue;
        const names = (ts.getDecorators(m) ?? []).map(decoratorName);
        if (!names.some((n) => n !== null && HTTP.has(n))) continue;
        const verdict = verdictOf(m, st, () => reach(m, path, cls, 0, new Map()));
        handlers.push({ key: `${where}#${st.name.text}.${m.name.text}`, verdict });
      }
    }
  }
  return handlers.sort((a, b) => a.key.localeCompare(b.key));
}

/** Every non-test source under `root`, for {@link scanRoutes}. */
export function readSources(root: string): SourceFile[] {
  return apiSourceFiles(root).map((file) => ({
    path: file.replace(/\\/g, '/'),
    text: readFileSync(file, 'utf8'),
  }));
}
