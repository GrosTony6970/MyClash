import { describe, expect, it, vi } from 'vitest';
import { PenaltiesController } from './penalties.controller';

/**
 * `GET /matches/:id/penalty-scope` must let the caller's identity reach a
 * decision.
 *
 * It is the one route in this module that aggregates a fighter's cards across a
 * whole TOURNAMENT. Its neighbour `/matches/:id/penalties` is `@Public()` — a
 * per-match list a spectator display legitimately reads — and copying that
 * decorator across would have been the easy mistake: same shape, same module,
 * much wider answer.
 *
 * The failure this guards against is the one the referees sweep found on
 * 2026-08-15: twenty handlers that never touched the request object at all.
 * Under the global AuthGuard they still required *a* logged-in account, so
 * nothing looked broken — the identity simply never left the wire. A handler
 * that forgets its authorizer fails here rather than in a hall.
 *
 * `authorizeMatchScoring` is match-scoped staff authorisation, not a signed-in
 * test. That distinction is the whole point: `assertCanReadEvent` is not the bar
 * for staff data.
 */
describe('GET /matches/:id/penalty-scope authorisation', () => {
  function build() {
    const authorizeMatchScoring = vi.fn().mockResolvedValue({ userId: 'u-1' });
    const getPenaltyScopeForMatch = vi
      .fn()
      .mockResolvedValue({ accumulationScope: 'match', priors: {} });
    // Direct instantiation, not Test.createTestingModule with useValue mocks:
    // vitest does not guarantee emitDecoratorMetadata at test runtime, so the
    // DI container silently injects undefined.
    const controller = new PenaltiesController(
      { getPenaltyScopeForMatch } as never,
      {} as never,
      { authorizeMatchScoring } as never,
    );
    return { controller, authorizeMatchScoring, getPenaltyScopeForMatch };
  }

  it('authorizes the caller against the match before answering', async () => {
    const { controller, authorizeMatchScoring, getPenaltyScopeForMatch } = build();
    const req = { headers: {} } as never;

    await controller.getMatchPenaltyScope('m-1', req);

    expect(authorizeMatchScoring).toHaveBeenCalledWith(req, 'm-1');
    expect(getPenaltyScopeForMatch).toHaveBeenCalledWith('m-1');
  });

  it('does not answer when authorisation refuses', async () => {
    const { controller, authorizeMatchScoring, getPenaltyScopeForMatch } = build();
    authorizeMatchScoring.mockRejectedValue(new Error('forbidden'));

    await expect(controller.getMatchPenaltyScope('m-1', { headers: {} } as never)).rejects.toThrow(
      'forbidden',
    );
    // The refusal has to happen BEFORE the read. Awaiting the authorizer after
    // fetching would still throw and still look green from the outside, while
    // the query had already run.
    expect(getPenaltyScopeForMatch).not.toHaveBeenCalled();
  });
});
