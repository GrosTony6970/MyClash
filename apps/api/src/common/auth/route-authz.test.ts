/**
 * Every HTTP handler of the API must reach something that can REFUSE the
 * caller, unless it says it is public.
 *
 * The AuthGuard runs in shadow mode in production: a route without a check of
 * its own serves anyone on the internet. Three module sweeps found holes each
 * time — twenty in referees (2026-08-15), three in matches (08-16), seven in
 * persons (09-18) — and each sweep, scoped to its module, hid the rest. This
 * one reads every controller, and replaces the per-module rule those sweeps
 * left behind.
 *
 * The rule, and why it follows calls into the services, is in
 * `common/testing/route-authz-scan.ts`. The reviewed lists — today's offenders,
 * which may only shrink; the routes that decide in a way the scan does not
 * count; and the routes it passes that a reading showed are open — are in
 * `common/testing/route-authz-ledger.ts`.
 */
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DECIDED_ELSEWHERE, FALSE_PASSES, UNDECIDED } from '../testing/route-authz-ledger';
import {
  readSources,
  REFUSERS,
  scanRoutes,
  type RouteVerdict,
  type SourceFile,
} from '../testing/route-authz-scan';

const SRC = join(__dirname, '..', '..').replace(/\\/g, '/');
const SOURCES = readSources(SRC);
const scanned = scanRoutes(SOURCES, SRC);
const raw = new Map(scanned.map((h) => [h.key, h.verdict]));
/** A reviewed false pass counts as what a reading showed it is: undecided. */
const handlers = scanned.map((h) =>
  h.key in FALSE_PASSES ? { ...h, verdict: 'undecided' as const } : h,
);
const verdicts = new Map(handlers.map((h) => [h.key, h.verdict]));

describe('route authorization, API-wide', () => {
  it('finds the routes, so an empty sweep cannot pass as a clean one', () => {
    expect(handlers.length).toBeGreaterThanOrEqual(600);
    // Every kind is present, or a verdict is exempting everything or nothing.
    for (const kind of ['public', 'platform-guard', 'decides', 'self', 'undecided']) {
      expect(handlers.filter((h) => h.verdict === kind).length, kind).toBeGreaterThan(0);
    }
  });

  it('lets no new route act without anything that can refuse the caller', () => {
    const offenders = handlers
      .filter((h) => h.verdict === 'undecided')
      .filter((h) => !(h.key in UNDECIDED) && !(h.key in DECIDED_ELSEWHERE))
      .map((h) => h.key);
    expect(
      offenders,
      'these routes reach nothing that can refuse the caller — give each an org-role, ' +
        'platform, staff or participant check, or a @Public() for a read that is open:\n  ' +
        offenders.join('\n  '),
    ).toEqual([]);
  });

  it('shrinks: every ledger line is a route that still decides nothing', () => {
    const stale = Object.keys(UNDECIDED).filter((key) => verdicts.get(key) !== 'undecided');
    expect(
      stale,
      'these routes now decide, or no longer exist — delete their lines from UNDECIDED:\n  ' +
        stale.join('\n  '),
    ).toEqual([]);
  });

  it('exempts only routes the scan still does not count', () => {
    const stale = Object.keys(DECIDED_ELSEWHERE).filter(
      (key) => verdicts.get(key) !== 'undecided' || key in UNDECIDED,
    );
    expect(stale, 'delete these lines from DECIDED_ELSEWHERE:\n  ' + stale.join('\n  ')).toEqual(
      [],
    );
  });

  it('keeps a false pass on the ledger, and only while the scan still passes it', () => {
    const stale = Object.keys(FALSE_PASSES).filter(
      (key) => !raw.has(key) || raw.get(key) === 'undecided' || !(key in UNDECIDED),
    );
    expect(stale, 'check these FALSE_PASSES lines:\n  ' + stale.join('\n  ')).toEqual([]);
  });

  it('counts each refuser by a name defined once, so a namesake that only looks cannot pass', () => {
    const definitions = (name: string): number =>
      SOURCES.reduce(
        (n, s) =>
          n +
          [...s.text.matchAll(new RegExp(`\\b(async|function)\\s+${name}\\s*[(<]`, 'g'))].length,
        0,
      );
    expect(REFUSERS.filter((name) => definitions(name) !== 1)).toEqual([]);
  });

  it('pins the lists: lower a length with each fix, never raise it to let a route through', () => {
    // A new unchecked route plus its own ledger line would otherwise stay green.
    expect(Object.keys(UNDECIDED)).toHaveLength(2);
    expect(Object.keys(DECIDED_ELSEWHERE)).toHaveLength(22);
    expect(Object.keys(FALSE_PASSES)).toHaveLength(2);
  });
});

// ── The rule itself, on sources made up for the purpose ──────────────────────

const ROOT = resolve(__dirname, 'virtual-src').replace(/\\/g, '/');
const file = (path: string, text: string): SourceFile => ({ path: `${ROOT}/${path}`, text });

/** A wrapper around the refuser, and the public-read gate that is never followed. */
const AUTHZ = file(
  'common/auth/event-authz.ts',
  `export async function assertCanManageEvent(deps: Deps, eventId: string, userId: string) {
     await deps.orgs.assertOrgRole(eventId, userId, 'editor');
   }
   export async function assertCanReadEvent(deps: Deps, eventId: string, user: () => Promise<string>) {
     await deps.orgs.assertOrgRole(eventId, await user(), 'read_only');
   }`,
);

interface Shape {
  /** The route decorator. */
  verb?: string;
  /** The handler's route; a `me` segment makes it a self-service route. */
  path?: string;
  handler?: string;
  /** The body of `ThingsService.act`, the method the default handler calls. */
  service?: string;
  /** More members of the controller. */
  extra?: string;
  classDecorators?: string;
  methodDecorators?: string;
}

/** Scan one controller + service; the default handler resolves the caller as the repo does. */
function verdictOf(shape: Shape): RouteVerdict {
  const {
    verb = 'Post',
    path = 'things',
    handler = 'return this.things.act(await getUserId(req));',
    service = 'return 1;',
    extra = '',
    classDecorators = '',
    methodDecorators = '',
  } = shape;
  const controller = file(
    'modules/things/things.controller.ts',
    `import { assertCanManageEvent } from '../../common/auth/event-authz';
     import { ThingsService } from './things.service';
     async function getUserId(req: { token: string }): Promise<string> {
       const user = await supabase.getAuthUser(req.token);
       if (!user) throw new UnauthorizedException('Authentication required');
       return user.id;
     }
     ${classDecorators}
     @Controller()
     export class ThingsController {
       constructor(private readonly things: ThingsService) {}
       ${methodDecorators}
       @${verb}('${path}')
       async act(@Req() req: { token: string }) { ${handler} }
       ${extra}
     }`,
  );
  const things = file(
    'modules/things/things.service.ts',
    `import { assertCanManageEvent, assertCanReadEvent } from '../../common/auth/event-authz';
     export class ThingsService {
       constructor(private readonly orgs: OrganizationsService) {}
       async act(userId: string) { ${service} }
       async other(userId: string) { await this.orgs.assertOrgRole('org', userId, 'admin'); }
     }`,
  );
  const scanned = scanRoutes([AUTHZ, controller, things], ROOT);
  return scanned.find((h) => h.key.endsWith('#ThingsController.act'))!.verdict;
}

const RULE: Array<[string, Shape, RouteVerdict]> = [
  [
    'a route that resolves the caller only to stamp the row',
    { service: `await db.insert({ created_by_user_id: userId });` },
    'undecided',
  ],
  [
    "an injected service's org-role check, followed through its import",
    { service: `await this.orgs.assertOrgRole('org', userId, 'editor');` },
    'decides',
  ],
  [
    'an imported helper, followed to the refuser inside it',
    { service: `await assertCanManageEvent(deps, 'e', userId);` },
    'decides',
  ],
  [
    'a check the handler makes itself',
    { handler: `await assertCanManageEvent(deps, 'e', await getUserId(req)); return 1;` },
    'decides',
  ],
  [
    'a same-class helper of the controller',
    {
      handler: 'await this.authorize(req); return 1;',
      extra: `private async authorize(req: unknown) { await orgs.assertOrgRole('o', 'u', 'editor'); }`,
    },
    'decides',
  ],
  ['the method called, not a sibling of it', { service: 'return 1;' }, 'undecided'],
  [
    'a validation assert',
    { service: 'assertPoolEditable(pool); await db.update(pool);' },
    'undecided',
  ],
  [
    'a comment that names a check',
    // On lines of their own: a comment trailing the opening brace is dropped by
    // any printer, so it would pin nothing.
    {
      service: `await db.a();\n// assertOrgRole(orgId, userId, 'editor')\n/* assertOrgRole(o, u) */\nawait db.x();`,
    },
    'undecided',
  ],
  [
    'a query filtered on some user_id, which may come from the URL',
    { service: `return db.from('t').select('*').eq('user_id', userId);` },
    'undecided',
  ],
  [
    'a lookup that returns null instead of refusing',
    { service: 'return this.identity.resolvePersonId(req, eventId);' },
    'undecided',
  ],
  [
    'a 403 that is not about the caller',
    {
      service: `if (plan.builtIn) throw new ForbiddenException('Built-in plans cannot be changed');`,
    },
    'undecided',
  ],
  [
    "an Event's public-read gate, which lets anyone through once published",
    { service: `await assertCanReadEvent(deps, 'e', async () => userId);` },
    'undecided',
  ],
  ['a me route that refuses anonymous callers', { path: 'me/things' }, 'self'],
  [
    'a me route that lets anonymous callers through',
    { path: 'me/things', handler: `return this.things.act('anonymous');` },
    'undecided',
  ],
  ['@Public() on the class', { classDecorators: '@Public()' }, 'public'],
  ['@Public() on the handler', { methodDecorators: '@Public()' }, 'public'],
  [
    'the platform guard on the class',
    { classDecorators: '@UseGuards(PlatformRoleGuard)' },
    'platform-guard',
  ],
  [
    'the platform guard on the handler',
    { methodDecorators: '@UseGuards(PlatformRoleGuard)' },
    'platform-guard',
  ],
  ['another guard', { classDecorators: '@UseGuards(ThrottlerGuard)' }, 'undecided'],
  [
    'a route declared with @All, read like any other',
    {
      verb: 'All',
      handler: `await assertCanManageEvent(deps, 'e', await getUserId(req)); return 1;`,
    },
    'decides',
  ],
];

describe('the route authorization rule', () => {
  for (const [title, shape, verdict] of RULE) {
    it(`${title} → ${verdict}`, () => {
      expect(verdictOf(shape)).toBe(verdict);
    });
  }
});
