/**
 * event-readonly.guard.test.ts — EventReadOnlyGuard
 *
 * Tests:
 *   ✓ passes when verb is GET (no DB lookup)
 *   ✓ passes when @AllowOnArchivedEvent is set (regardless of event status)
 *   ✓ blocks mutation when event.status === 'archived' (throws ForbiddenException)
 *   ✓ allows mutation when event.status === 'running'
 *   ✓ passes when no event id can be resolved (route not event-scoped)
 *   ✓ resolves through tournamentId → events.id chain
 */

import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventReadOnlyGuard } from './event-readonly.guard';
import { ALLOW_ON_ARCHIVED_EVENT_KEY } from './allow-on-archived.decorator';
import { BLOCK_ON_COMPLETED_EVENT_KEY } from './block-on-completed.decorator';

// ── Mock helpers ──────────────────────────────────────────────────────────────

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

const reflectorGetAllAndOverride = vi.fn();
const mockReflector = { getAllAndOverride: reflectorGetAllAndOverride };

function makeChain(result: unknown) {
  const chain = {
    select: vi.fn() as ReturnType<typeof vi.fn>,
    eq: vi.fn() as ReturnType<typeof vi.fn>,
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  return chain;
}

function makeContext(opts: {
  method?: string;
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  url?: string;
  allowOnArchived?: boolean;
  blockOnCompleted?: boolean;
}): ExecutionContext {
  const {
    method = 'POST',
    params = {},
    body = {},
    url = '',
    allowOnArchived = false,
    blockOnCompleted = false,
  } = opts;

  // Keyed per metadata key: the guard now reads TWO, and a blanket
  // mockReturnValue would make every route look like it carried both.
  reflectorGetAllAndOverride.mockImplementation((key: string) => {
    if (key === ALLOW_ON_ARCHIVED_EVENT_KEY) return allowOnArchived ? true : undefined;
    if (key === BLOCK_ON_COMPLETED_EVENT_KEY) return blockOnCompleted ? true : undefined;
    return undefined;
  });

  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, params, body, url }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

/** A real event id shape — the path match requires 36 chars. */
const EVENT_UUID = 'aaba08c8-f692-49ac-ace3-45ce2c58ef8a';
const MATCH_UUID = 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e';
const LICE_UUID = 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EventReadOnlyGuard', () => {
  let guard: EventReadOnlyGuard;

  beforeEach(() => {
    vi.clearAllMocks();
    // Drain the FIFO `mockReturnValueOnce` queue as well: clearAllMocks resets
    // call history but NOT queued return values, so a spec that resolves fewer
    // chains than it queued leaks the rest into the next spec in file order —
    // which is how a broken match branch showed up as failing lice specs.
    fromMock.mockReset();
    guard = new EventReadOnlyGuard(mockSupabase as never, mockReflector as never);
  });

  // ── (1) GET skips all DB lookups ──────────────────────────────────────────

  it('passes when verb is GET without any DB lookup', async () => {
    const ctx = makeContext({ method: 'GET', params: { eventId: 'event-1' } });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('passes when verb is HEAD without any DB lookup', async () => {
    const ctx = makeContext({ method: 'HEAD' });
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(fromMock).not.toHaveBeenCalled();
  });

  // ── (2) @AllowOnArchivedEvent bypasses the guard ──────────────────────────

  it('passes when @AllowOnArchivedEvent is set, regardless of event status', async () => {
    const ctx = makeContext({
      method: 'POST',
      params: { eventId: 'event-1' },
      allowOnArchived: true,
    });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    // Guard must not hit the DB when the opt-out decorator is present
    expect(fromMock).not.toHaveBeenCalled();
    expect(reflectorGetAllAndOverride).toHaveBeenCalledWith(ALLOW_ON_ARCHIVED_EVENT_KEY, [
      expect.anything(),
      expect.anything(),
    ]);
  });

  // ── (3) Blocks mutation on archived events ────────────────────────────────

  it('throws ForbiddenException when event.status === "archived"', async () => {
    const ctx = makeContext({ method: 'POST', params: { eventId: 'event-archived' } });

    fromMock.mockReturnValueOnce(makeChain({ data: { status: 'archived' }, error: null }));

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('throws ForbiddenException with the correct message on archived event', async () => {
    const ctx = makeContext({ method: 'POST', params: { eventId: 'event-archived' } });

    fromMock.mockReturnValueOnce(makeChain({ data: { status: 'archived' }, error: null }));

    await expect(guard.canActivate(ctx)).rejects.toThrow(
      'This event is archived and read-only. Only deletion requests are allowed.',
    );
  });

  // ── (4) Allows mutation on non-archived events ────────────────────────────

  it('returns true when event.status === "running"', async () => {
    const ctx = makeContext({ method: 'POST', params: { eventId: 'event-running' } });

    fromMock.mockReturnValueOnce(makeChain({ data: { status: 'running' }, error: null }));

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('returns true when event.status === "draft"', async () => {
    const ctx = makeContext({ method: 'PATCH', params: { eventId: 'event-draft' } });

    fromMock.mockReturnValueOnce(makeChain({ data: { status: 'draft' }, error: null }));

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  // ── (5) Passes when no event id can be resolved ───────────────────────────

  it('passes when no event id can be resolved (non-event-scoped route)', async () => {
    // Route with no params and no body.eventId → resolveEventId returns null
    const ctx = makeContext({ method: 'POST', params: {}, body: {} });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    // No DB calls should happen
    expect(fromMock).not.toHaveBeenCalled();
  });

  // ── (6) Resolves through tournamentId → events chain ─────────────────────

  it('resolves eventId via tournamentId → tournaments.event_id chain', async () => {
    const ctx = makeContext({ method: 'DELETE', params: { tournamentId: 'tournament-1' } });

    // First call: tournaments lookup → returns event_id
    const tournamentChain = makeChain({ data: { event_id: 'event-from-tournament' }, error: null });
    // Second call: events status lookup → archived
    const eventChain = makeChain({ data: { status: 'archived' }, error: null });

    fromMock.mockReturnValueOnce(tournamentChain).mockReturnValueOnce(eventChain);

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);

    // Verify tournaments table was queried
    expect(fromMock).toHaveBeenNthCalledWith(1, 'tournaments');
    expect(fromMock).toHaveBeenNthCalledWith(2, 'events');
  });

  // ── (7) Fails open when event not found ──────────────────────────────────

  it('passes through when the event row does not exist (fails open)', async () => {
    const ctx = makeContext({ method: 'POST', params: { eventId: 'nonexistent-event' } });

    fromMock.mockReturnValueOnce(makeChain({ data: null, error: null }));

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  // ── (8) Resolves via body.eventId fallback ────────────────────────────────

  it('resolves eventId from body.eventId when no params are present', async () => {
    const ctx = makeContext({ method: 'POST', params: {}, body: { eventId: 'event-from-body' } });

    fromMock.mockReturnValueOnce(makeChain({ data: { status: 'archived' }, error: null }));

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    expect(fromMock).toHaveBeenCalledWith('events');
  });

  // ── (9) The event's OWN routes, which name the param `:id` ────────────────
  //
  // PATCH events/:id, POST events/:id/publish|unpublish|logo|hero all bind
  // `params.id`, which no branch read — so every one of them slipped past the
  // guard and an archived event stayed editable. Confirmed against the deployed
  // API before the fix: archive an event, PATCH it, 200.

  it.each([
    ['PATCH', `/api/v1/events/${EVENT_UUID}`],
    ['POST', `/api/v1/events/${EVENT_UUID}/publish`],
    ['POST', `/api/v1/events/${EVENT_UUID}/unpublish`],
    ['POST', `/api/v1/events/${EVENT_UUID}/logo`],
  ])('blocks %s %s on an archived event', async (method, url) => {
    const ctx = makeContext({ method, params: { id: EVENT_UUID }, url });

    fromMock.mockReturnValueOnce(makeChain({ data: { status: 'archived' }, error: null }));

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    expect(fromMock).toHaveBeenCalledWith('events');
  });

  it('allows the same routes when the event is not archived', async () => {
    const ctx = makeContext({
      method: 'PATCH',
      params: { id: EVENT_UUID },
      url: `/api/v1/events/${EVENT_UUID}`,
    });

    fromMock.mockReturnValueOnce(makeChain({ data: { status: 'draft' }, error: null }));

    expect(await guard.canActivate(ctx)).toBe(true);
  });

  // ── (10) The schedule routes, which also name their param `:id` ───────────
  //
  // The guard resolved an event from `params['matchId']`. No mutating route in
  // this API binds that name — they are all `matches/:id` — so the branch was
  // dead, `resolveEventId` returned null, the guard treated every match write
  // as "not event-scoped" and an ARCHIVED event stayed fully re-schedulable.
  // public-routes.test.ts had stated this defect in a comment for months with
  // nothing behind it. This is the something.

  /** matches → event in ONE query, via the embedded select. */
  function matchChain(eventId: string | null) {
    return makeChain({
      data: eventId ? { phases: { tournaments: { event_id: eventId } } } : null,
      error: null,
    });
  }

  it.each([
    ['PATCH', `/api/v1/matches/${MATCH_UUID}/schedule`, 'the route this fix exists for'],
    ['POST', `/api/v1/matches/${MATCH_UUID}/exchanges`, 'scoring into an archived event'],
    ['PATCH', `/api/v1/matches/${MATCH_UUID}/swiss-sides`, 'the only real :matchId route'],
  ])('blocks %s %s on an archived event — %s', async (method, url) => {
    const ctx = makeContext({ method, params: { id: MATCH_UUID }, url });

    fromMock
      .mockReturnValueOnce(matchChain(EVENT_UUID))
      .mockReturnValueOnce(makeChain({ data: { status: 'archived' }, error: null }));

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('resolves a match in exactly two queries, not the three the dead branch walked', async () => {
    const ctx = makeContext({
      method: 'PATCH',
      params: { id: MATCH_UUID },
      url: `/api/v1/matches/${MATCH_UUID}/schedule`,
    });

    fromMock
      .mockReturnValueOnce(matchChain(EVENT_UUID))
      .mockReturnValueOnce(makeChain({ data: { status: 'running' }, error: null }));

    expect(await guard.canActivate(ctx)).toBe(true);
    expect(fromMock).toHaveBeenCalledTimes(2);
    expect(fromMock).toHaveBeenNthCalledWith(1, 'matches');
    expect(fromMock).toHaveBeenNthCalledWith(2, 'events');
  });

  it('allows a match write when the event is not archived', async () => {
    const ctx = makeContext({
      method: 'PATCH',
      params: { id: MATCH_UUID },
      url: `/api/v1/matches/${MATCH_UUID}/schedule`,
    });

    fromMock
      .mockReturnValueOnce(matchChain(EVENT_UUID))
      .mockReturnValueOnce(makeChain({ data: { status: 'running' }, error: null }));

    expect(await guard.canActivate(ctx)).toBe(true);
  });

  /**
   * `match-forfeits` starts with the same eight characters. If the regex ever
   * loosens to a substring match it would resolve this route through the
   * matches table and 500 on a forfeit id.
   */
  it('does not mistake `match-forfeits/:id` for a match route', async () => {
    const ctx = makeContext({
      method: 'PATCH',
      params: { id: MATCH_UUID },
      url: `/api/v1/match-forfeits/${MATCH_UUID}/void`,
    });

    expect(await guard.canActivate(ctx)).toBe(true);
    expect(fromMock).not.toHaveBeenCalled();
  });

  // ── (11) Lices, whose deletion unschedules every match on the strip ───────

  it.each([['PATCH'], ['DELETE']])('blocks %s /lices/:id on an archived event', async (method) => {
    const ctx = makeContext({
      method,
      params: { id: LICE_UUID },
      url: `/api/v1/lices/${LICE_UUID}`,
    });

    fromMock
      .mockReturnValueOnce(makeChain({ data: { event_id: EVENT_UUID }, error: null }))
      .mockReturnValueOnce(makeChain({ data: { status: 'archived' }, error: null }));

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    expect(fromMock).toHaveBeenNthCalledWith(1, 'lices');
  });

  it('allows a lice edit when the event is not archived', async () => {
    const ctx = makeContext({
      method: 'PATCH',
      params: { id: LICE_UUID },
      url: `/api/v1/lices/${LICE_UUID}`,
    });

    fromMock
      .mockReturnValueOnce(makeChain({ data: { event_id: EVENT_UUID }, error: null }))
      .mockReturnValueOnce(makeChain({ data: { status: 'published' }, error: null }));

    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('falls through when the match resolves to no event', async () => {
    const ctx = makeContext({
      method: 'PATCH',
      params: { id: MATCH_UUID },
      url: `/api/v1/matches/${MATCH_UUID}/schedule`,
    });

    fromMock.mockReturnValueOnce(matchChain(null));

    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('does not read `:id` on another entity’s route', async () => {
    // `PATCH tournaments/:id` binds the same param name for a different entity.
    // Matching the PATH is what keeps the two apart — resolving `params.id` as
    // an event id would send this down the tournaments branch's job.
    const ctx = makeContext({
      method: 'PATCH',
      params: { id: EVENT_UUID },
      url: `/api/v1/tournaments/${EVENT_UUID}`,
    });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(fromMock).not.toHaveBeenCalled();
  });

  // ── @BlockOnCompletedEvent ────────────────────────────────────────────────
  // A completed event is finished but not put away, and tidying the record is
  // legitimate. Only the routes that DESTROY the plan carry the marker.

  describe('completed events', () => {
    it('refuses a marked route on a completed event', async () => {
      const ctx = makeContext({
        params: { tournamentId: 'tournament-1' },
        blockOnCompleted: true,
        url: '/api/v1/tournaments/tournament-1/generate-pools',
      });
      fromMock
        // tournamentId → tournaments.event_id, then events.status
        .mockReturnValueOnce(makeChain({ data: { event_id: EVENT_UUID }, error: null }))
        .mockReturnValueOnce(makeChain({ data: { status: 'completed' }, error: null }));

      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows an UNMARKED route on the same completed event', async () => {
      // The half that makes this a scalpel rather than a freeze: re-timing a
      // bout on a finished event is exactly the tidying we mean to permit.
      const ctx = makeContext({
        params: { tournamentId: 'tournament-1' },
        url: '/api/v1/tournaments/tournament-1/pools',
      });
      fromMock
        .mockReturnValueOnce(makeChain({ data: { event_id: EVENT_UUID }, error: null }))
        .mockReturnValueOnce(makeChain({ data: { status: 'completed' }, error: null }));

      expect(await guard.canActivate(ctx)).toBe(true);
    });

    it('allows a marked route while the event is still running', async () => {
      const ctx = makeContext({
        params: { tournamentId: 'tournament-1' },
        blockOnCompleted: true,
        url: '/api/v1/tournaments/tournament-1/generate-pools',
      });
      fromMock
        .mockReturnValueOnce(makeChain({ data: { event_id: EVENT_UUID }, error: null }))
        .mockReturnValueOnce(makeChain({ data: { status: 'running' }, error: null }));

      expect(await guard.canActivate(ctx)).toBe(true);
    });

    it('FAILS CLOSED when a marked route cannot resolve its event', async () => {
      // The whole reason the marker is read before the resolve. An unresolvable
      // event means "not event-scoped" for the archived sweep, which runs on
      // every route in the API and must pass. On a route somebody deliberately
      // marked, the same silence means the protection has quietly stopped
      // working — this file has shipped that failure twice. Loud beats silent.
      const ctx = makeContext({ blockOnCompleted: true, url: '/api/v1/something-unscoped' });

      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
      expect(fromMock).not.toHaveBeenCalled();
    });

    it('still passes an unmarked route that cannot resolve its event', async () => {
      const ctx = makeContext({ url: '/api/v1/something-unscoped' });

      expect(await guard.canActivate(ctx)).toBe(true);
    });
  });

  // ── Resolver branches added for the marked referee routes ─────────────────
  // Without these the two DELETEs below resolve to null, and a marked route
  // that cannot resolve now throws — so a missing branch is loud, not silent.

  describe('referee route resolution', () => {
    const ROUND_UUID = 'd1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a';
    const ASSIGNMENT_UUID = 'e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b';

    it('resolves swiss-rounds/<uuid> through phases → tournaments', async () => {
      fromMock
        .mockReturnValueOnce(
          makeChain({
            data: { phases: { tournaments: { event_id: EVENT_UUID } } },
            error: null,
          }),
        )
        .mockReturnValueOnce(makeChain({ data: { status: 'completed' }, error: null }));
      const ctx = makeContext({
        method: 'DELETE',
        params: { roundId: ROUND_UUID },
        blockOnCompleted: true,
        url: `/api/v1/swiss-rounds/${ROUND_UUID}/referee-assignments`,
      });

      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('resolves referee-assignments/<uuid> off its own event_id column', async () => {
      fromMock
        .mockReturnValueOnce(makeChain({ data: { event_id: EVENT_UUID }, error: null }))
        .mockReturnValueOnce(makeChain({ data: { status: 'archived' }, error: null }));
      const ctx = makeContext({
        method: 'DELETE',
        params: { id: ASSIGNMENT_UUID },
        url: `/api/v1/referee-assignments/${ASSIGNMENT_UUID}`,
      });

      // Archived, not completed: this branch also closes a pre-existing hole
      // where deleting an assignment on an ARCHIVED event was never checked.
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
