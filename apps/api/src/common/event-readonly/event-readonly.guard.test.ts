/**
 * EventReadOnlyGuard: what it does once it knows the Event.
 *
 * Which Event a request touches is the resolver's job, tested on its own
 * (`resolve-event-id.test.ts`), API-wide (`archived-lock.routes.test.ts`) and
 * through the real router (`archived-lock.http.test.ts`). Here: the verbs it
 * skips, the opt-out, archived and completed, and an unplaced route.
 */

import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';
import { mockSupabase } from '../testing/supabase-chain';
import { EventReadOnlyGuard } from './event-readonly.guard';
import { ALLOW_ON_ARCHIVED_EVENT_KEY } from './allow-on-archived.decorator';
import { BLOCK_ON_COMPLETED_EVENT_KEY } from './block-on-completed.decorator';

const EVENT = 'aaba08c8-f692-49ac-ace3-45ce2c58ef8a';
const TOURNAMENT = 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';
const ARCHIVED_WORDING = 'This event is archived and read-only.';
const COMPLETED_WORDING =
  'This event is completed. Re-open it before regenerating or deleting its plan.';

function harness(status: string | null) {
  const db = mockSupabase({
    events: { rows: status === null ? [] : [{ id: EVENT, status }] },
    tournaments: { rows: [{ id: TOURNAMENT, event_id: EVENT }] },
  });
  return { db, guard: new EventReadOnlyGuard(db as never, reflector as never) };
}

const marks = { allow: false, block: false };
const reflector = {
  getAllAndOverride: vi.fn((key: string) => {
    if (key === ALLOW_ON_ARCHIVED_EVENT_KEY) return marks.allow || undefined;
    if (key === BLOCK_ON_COMPLETED_EVENT_KEY) return marks.block || undefined;
    return undefined;
  }),
};

function context(opts: {
  method?: string;
  route: string;
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  allow?: boolean;
  block?: boolean;
}): ExecutionContext {
  marks.allow = opts.allow ?? false;
  marks.block = opts.block ?? false;
  const request = {
    method: opts.method ?? 'POST',
    url: opts.route,
    routeOptions: { url: `/api/v1/${opts.route}` },
    params: opts.params ?? {},
    body: opts.body ?? {},
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

const eventWrite = { route: 'events/:eventId/things', params: { eventId: EVENT } };
const tournamentWrite = { route: 'tournaments/:id', params: { id: TOURNAMENT } };

describe('EventReadOnlyGuard', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])('lets %s through without a read', async (method) => {
    const { db, guard } = harness('archived');
    expect(await guard.canActivate(context({ ...eventWrite, method }))).toBe(true);
    expect(db.from).not.toHaveBeenCalled();
  });

  it('lets a route marked @AllowOnArchivedEvent through without a read', async () => {
    const { db, guard } = harness('archived');
    expect(await guard.canActivate(context({ ...eventWrite, allow: true }))).toBe(true);
    expect(db.from).not.toHaveBeenCalled();
  });

  it('refuses a write to an archived Event, in its own words', async () => {
    const { guard } = harness('archived');
    await expect(guard.canActivate(context(eventWrite))).rejects.toEqual(
      new ForbiddenException(ARCHIVED_WORDING),
    );
  });

  it('refuses a write to a Tournament of an archived Event (ruling 222)', async () => {
    const { guard } = harness('archived');
    await expect(
      guard.canActivate(context({ ...tournamentWrite, method: 'PATCH' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a write whose body names an archived Event', async () => {
    const { guard } = harness('archived');
    const legacy = context({ route: 'referee-assignments', body: { eventId: EVENT } });
    await expect(guard.canActivate(legacy)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each(['draft', 'published', 'running', 'completed'])(
    'lets a write through on a %s Event',
    async (status) => {
      const { guard } = harness(status);
      expect(await guard.canActivate(context(eventWrite))).toBe(true);
    },
  );

  it('lets a write through when its Event is not found, for the handler to answer', async () => {
    const { guard } = harness(null);
    expect(await guard.canActivate(context(eventWrite))).toBe(true);
  });

  it('answers 500 when it cannot read the Event, and lets no write through', async () => {
    const db = mockSupabase({
      events: { data: null, error: { code: '08006', message: 'connection refused' } },
    });
    const guard = new EventReadOnlyGuard(db as never, reflector as never);
    await expect(guard.canActivate(context(eventWrite))).rejects.toEqual(
      new Error('The archived-Event lock could not read an Event: connection refused'),
    );
  });

  it('lets a route through that is about no Event, without a read', async () => {
    // `clubs/:id` binds `:id` for a club: the resolver keys on the segment, so it
    // is not read as an Event's id.
    const { db, guard } = harness('archived');
    const club = context({ route: 'clubs/:id', params: { id: EVENT }, method: 'PATCH' });
    expect(await guard.canActivate(club)).toBe(true);
    expect(db.from).not.toHaveBeenCalled();
  });

  // ── @BlockOnCompletedEvent ────────────────────────────────────────────────
  // A completed event is finished but not put away, and tidying the record is
  // legitimate. Only the routes that DESTROY the plan carry the marker.

  describe('completed events', () => {
    const generate = {
      route: 'tournaments/:tournamentId/generate-pools',
      params: { tournamentId: TOURNAMENT },
    };

    it('refuses a marked route on a completed event', async () => {
      const { guard } = harness('completed');
      await expect(guard.canActivate(context({ ...generate, block: true }))).rejects.toEqual(
        new ForbiddenException(COMPLETED_WORDING),
      );
    });

    it('allows an UNMARKED route on the same completed event', async () => {
      const { guard } = harness('completed');
      expect(await guard.canActivate(context(generate))).toBe(true);
    });

    it('allows a marked route while the event is still running', async () => {
      const { guard } = harness('running');
      expect(await guard.canActivate(context({ ...generate, block: true }))).toBe(true);
    });

    it('FAILS CLOSED when a marked route cannot resolve its event', async () => {
      // An unresolvable event means "not event-scoped" for the archived sweep,
      // which runs on every route in the API and must pass. On a route somebody
      // deliberately marked, the same silence means the protection has quietly
      // stopped working. Loud beats silent.
      const { db, guard } = harness('completed');
      const unscoped = context({ route: 'something-unscoped', block: true });
      await expect(guard.canActivate(unscoped)).rejects.toBeInstanceOf(ForbiddenException);
      expect(db.from).not.toHaveBeenCalled();
    });

    it('still passes an unmarked route that cannot resolve its event', async () => {
      const { guard } = harness('completed');
      expect(await guard.canActivate(context({ route: 'something-unscoped' }))).toBe(true);
    });
  });
});
