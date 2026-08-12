import { describe, it, expect, vi } from 'vitest';
import { MatchesController } from './matches.controller';

/**
 * The pre-flight must resolve the discard capability the way the WRITE path
 * will, not the way its own access check happens to.
 *
 * This shipped wrong and only a live run caught it. The endpoint gated on
 * `authorizeMatchScoring`, which never grants `canDiscardDependentResults` —
 * only `authorizeMatchOrganizer` does — so `canDiscard` came back `false` for
 * everybody, including the organisers the override exists for. The dialog would
 * have told an organiser to go and find an organiser.
 *
 * The unit test that was supposed to cover this passed a stub actor with the
 * flag already set, which is the classic shape of a fixture agreeing with
 * itself: it tested what `previewUncompletion` does with a capability, never
 * where the capability comes from. So this asserts the wiring instead —
 * scoring for access, organizer PROBED for the capability, and the probe's
 * refusal turned into `false` rather than a 403.
 */

const controllerFor = (organizerAllowed: boolean) => {
  const previewUncompletion = vi.fn().mockResolvedValue({ blocked: false });
  const staff = {
    authorizeMatchScoring: vi.fn().mockResolvedValue({
      userId: 'user-1',
      canOverrideLocked: true,
    }),
    authorizeMatchOrganizer: organizerAllowed
      ? vi.fn().mockResolvedValue({ userId: 'user-1', canDiscardDependentResults: true })
      : vi.fn().mockRejectedValue(new Error('Requires editor role or higher')),
  };
  const controller = new MatchesController(
    {} as never,
    {} as never,
    {} as never,
    staff as never,
    {} as never,
    { previewUncompletion } as never,
  );
  return { controller, staff, previewUncompletion };
};

describe('GET /matches/:id/uncomplete-preflight — where canDiscard comes from', () => {
  it('reports canDiscard TRUE for an actor the organizer check admits', async () => {
    const { controller, previewUncompletion } = controllerFor(true);

    await controller.uncompletePreflight('match-1', {} as never);

    expect(previewUncompletion).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({ canDiscardDependentResults: true }),
    );
  });

  it('reports canDiscard FALSE — not a 403 — when the organizer check refuses', async () => {
    // A pad scorekeeper must still be able to READ what undoing would cost;
    // they just cannot be the one to push it through.
    const { controller, previewUncompletion } = controllerFor(false);

    await expect(controller.uncompletePreflight('match-1', {} as never)).resolves.toBeDefined();
    expect(previewUncompletion).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({ canDiscardDependentResults: false }),
    );
  });

  it('asks the organizer question at all — the bug was never asking it', async () => {
    const { controller, staff } = controllerFor(true);

    await controller.uncompletePreflight('match-1', {} as never);

    expect(staff.authorizeMatchScoring, 'scoring gates access').toHaveBeenCalled();
    expect(staff.authorizeMatchOrganizer, 'organizer decides the capability').toHaveBeenCalled();
  });
});
