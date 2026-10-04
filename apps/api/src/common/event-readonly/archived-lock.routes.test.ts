/**
 * Every write route of the API either names the Event it touches, so the
 * archived-Event lock can refuse it, or says why not.
 *
 * The lock (`event-readonly.guard.ts`) lets a write through when its resolver
 * places it in no Event. Each hole it had was a route the resolver could not
 * place: an Event's own `:id` routes, every bout write, then the Tournament's,
 * registration, roster, Workshop and score-correction routes (ruling 222). Each
 * was found by a sweep of one module. This reads every controller.
 *
 * The reviewed lists are in `common/testing/archived-lock-ledger.ts`.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LOCKED_ELSEWHERE,
  NAMED_OPEN,
  NOT_EVENT_OWNED,
  OPEN_ON_PURPOSE,
  PLACED_BY_BODY,
} from '../testing/archived-lock-ledger';
import { readSources } from '../testing/route-authz-scan';
import { scanWriteRoutes, type WriteRoute } from '../testing/write-routes-scan';
import { PLACING_SEGMENTS, placementsOf } from './resolve-event-id';

const SRC = join(__dirname, '..', '..').replace(/\\/g, '/');
const routes = scanWriteRoutes(readSources(SRC));

const ID = '00000000-0000-4000-8000-000000000000';
const placements = (route: WriteRoute) =>
  placementsOf(route.pattern, Object.fromEntries(route.params.map((name) => [name, ID])));
const placed = routes.filter((route) => placements(route).length > 0);
const keys = (lists: Readonly<Record<string, readonly string[]>>) => Object.values(lists).flat();

const LISTS = {
  NOT_EVENT_OWNED: keys(NOT_EVENT_OWNED),
  PLACED_BY_BODY: [...PLACED_BY_BODY],
  LOCKED_ELSEWHERE: keys(LOCKED_ELSEWHERE),
  OPEN_ON_PURPOSE: keys(OPEN_ON_PURPOSE),
  NAMED_OPEN: keys(NAMED_OPEN),
};
const listed = new Set(Object.values(LISTS).flat());

describe('the archived-Event lock, API-wide', () => {
  it('finds the write routes, so an empty sweep cannot pass as a clean one', () => {
    expect(routes.length).toBeGreaterThan(300);
    for (const [name, list] of Object.entries(LISTS)) expect(list.length, name).toBeGreaterThan(0);
  });

  it('places every write route, or the ledger says why it does not', () => {
    const offenders = routes
      .filter((route) => placements(route).length === 0 && !route.allowedOnArchived)
      .filter((route) => !listed.has(route.key))
      .map((route) => route.key);
    expect(
      offenders,
      'the lock cannot tell which Event these routes write to, so it lets them through on an ' +
        'archived Event. Give the route a path the resolver places (`resolve-event-id.ts`), ' +
        'mark it @AllowOnArchivedEvent() with the ruling, or file it in archived-lock-ledger.ts:\n  ' +
        offenders.join('\n  '),
    ).toEqual([]);
  });

  it('keeps no stale ledger line: each one is a route that exists and is still not placed', () => {
    const unplaced = new Set(
      routes
        .filter((route) => placements(route).length === 0 && !route.allowedOnArchived)
        .map((route) => route.key),
    );
    expect([...listed].filter((key) => !unplaced.has(key))).toEqual([]);
  });

  it('files a route under one reason only', () => {
    const all = Object.values(LISTS).flat();
    expect(all.filter((key, i) => all.indexOf(key) !== i)).toEqual([]);
  });

  it('opens on an archived Event exactly the routes a ruling opened', () => {
    expect(routes.filter((route) => route.allowedOnArchived).map((route) => route.key)).toEqual([
      'DELETE admin/leagues/:leagueId/events/:eventId/tournament-links',
      'DELETE events/:id',
      'PATCH admin/events/:eventId/league-tournament-links/:linkId',
      'PATCH deletion-requests/:id/cancel',
      'PATCH exchanges/:id/edit',
      'PATCH exchanges/:id/revert-void',
      'PATCH exchanges/:id/void',
      'PATCH match-forfeits/:id/void',
      'PATCH match-penalties/:id/void',
      'PATCH persons/:id',
      'PATCH tournament-penalty-reviews/:id',
      'POST admin/events/:eventId/leagues/recompute',
      'POST admin/leagues/:leagueId/events/:eventId/link',
      'POST admin/leagues/:leagueId/tournaments/:tournamentId/link',
      'POST admin/leagues/:leagueId/tournaments/:tournamentId/request',
      'POST admin/review-queue/:type/:id/approve',
      'POST admin/review-queue/:type/:id/reject',
      'POST deletion-requests',
      'POST events/:eventId/feedback',
      'POST matches/:id/exchanges',
      'POST matches/:id/penalties',
      'POST workshops/:id/feedback',
    ]);
  });

  it('places every route marked to refuse a completed Event (an unplaced one refuses always)', () => {
    expect(
      routes.filter((r) => r.blockedOnCompleted && placements(r).length === 0).map((r) => r.key),
    ).toEqual([]);
  });

  it('reads each segment of its table for at least one real route', () => {
    const used = new Set(placed.flatMap((route) => placements(route).map((p) => p.segment)));
    expect(PLACING_SEGMENTS.filter((segment) => !used.has(segment))).toEqual([]);
  });

  it('pins the routes it places, and NAMED_OPEN may only shrink', () => {
    expect(placed).toHaveLength(183);
    expect(LISTS.NAMED_OPEN).toHaveLength(3);
  });
});

describe('the write-route scan, on a controller made up for the purpose', () => {
  const scan = (text: string) => scanWriteRoutes([{ path: '/x/things.controller.ts', text }]);

  it('joins the controller path to the handler path, and reads both marks', () => {
    const [route, ...rest] = scan(`
      @AllowOnArchivedEvent()
      @Controller('things')
      class ThingsController {
        @Get(':id') read() {}
        @Patch(':id/parts/:partId') @BlockOnCompletedEvent() write() {}
      }`);
    expect(rest).toEqual([]);
    expect(route).toEqual({
      key: 'PATCH things/:id/parts/:partId',
      method: 'PATCH',
      pattern: '/api/v1/things/:id/parts/:partId',
      params: ['id', 'partId'],
      allowedOnArchived: true,
      blockedOnCompleted: true,
    });
  });

  it('refuses a path it cannot read, rather than build a wrong one', () => {
    expect(() => scan(`@Controller() class C { @Post(PATH) write() {} }`)).toThrow(
      'write-routes-scan reads string paths only: PATH',
    );
  });
});
