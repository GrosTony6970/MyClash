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
}): ExecutionContext {
  const { method = 'POST', params = {}, body = {}, url = '', allowOnArchived = false } = opts;

  reflectorGetAllAndOverride.mockReturnValue(allowOnArchived ? true : undefined);

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EventReadOnlyGuard', () => {
  let guard: EventReadOnlyGuard;

  beforeEach(() => {
    vi.clearAllMocks();
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
});
