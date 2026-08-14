import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MatchesController } from './matches.controller';

/**
 * Every un-completion route must resolve the discard capability the same way,
 * and that way is NOT the one its access check uses.
 *
 * This shipped wrong twice, in the same shape, and both escaped the unit layer.
 *
 *   1. The pre-flight gated on `authorizeMatchScoring`, which never grants
 *      `canDiscardDependentResults` — only `authorizeMatchOrganizer` does — so
 *      `canDiscard` came back false for everybody and the dialog would have told
 *      an organiser to go and find an organiser.
 *   2. Fixing only the pre-flight left the WRITE paths on the old authorizer, so
 *      the pre-flight promised an override that `POST /reset` then refused with
 *      a 403. Worse than the first bug: the operator was told it would work.
 *
 * Both were found by the live E2E, because the unit tests passed a stub actor
 * with the capability already set — testing what the code does WITH a
 * capability, never where the capability comes from. A fixture agreeing with
 * itself.
 *
 * So: assert the wiring, and assert it across the whole set rather than the one
 * route that happened to break. `authorizeMatchScoringWithDiscard` is the single
 * owner — scoring for access, organizer probed for the capability.
 */

const ROUTES_THAT_UNCOMPLETE = [
  'uncompletePreflight',
  'resetMatch',
  'updateStatus',
  'clockAction',
] as const;

describe('every un-completion route resolves the discard capability the same way', () => {
  const source = readFileSync(join(__dirname, 'matches.controller.ts'), 'utf8');

  /** The body of one controller method, from its name to the next decorator. */
  const bodyOf = (method: string): string => {
    const start = source.indexOf(`async ${method}(`);
    expect(start, `${method} not found in the controller`).toBeGreaterThan(-1);
    const next = source.indexOf('\n  @', start);
    return source.slice(start, next === -1 ? source.length : next);
  };

  for (const method of ROUTES_THAT_UNCOMPLETE) {
    it(`${method} uses authorizeMatchScoringWithDiscard`, () => {
      const body = bodyOf(method);
      expect(
        body,
        `${method} can un-complete a match, so it must resolve the discard capability — ` +
          'authorizeMatchScoring alone never grants it and the acknowledged path 403s',
      ).toMatch(/authorizeMatchScoringWithDiscard\(/);
      // And not the bare one, which is the exact regression.
      expect(body).not.toMatch(/authorizeMatchScoring\(req/);
    });
  }
});

// ── The behaviour behind the helper ──────────────────────────────────────────

const controllerFor = (organizerAllowed: boolean) => {
  const previewUncompletion = vi.fn().mockResolvedValue({ blocked: false });
  const scoring = { userId: 'user-1', canOverrideLocked: true };
  const staff = {
    authorizeMatchScoringWithDiscard: vi
      .fn()
      .mockResolvedValue({ ...scoring, canDiscardDependentResults: organizerAllowed }),
  };
  const controller = new MatchesController(
    {} as never,
    {} as never,
    {} as never,
    staff as never,
    {} as never,
    { previewUncompletion } as never,
    {} as never,
    {} as never,
  );
  return { controller, staff, previewUncompletion };
};

describe('GET /matches/:id/uncomplete-preflight', () => {
  it('passes the resolved capability straight through to the preview', async () => {
    const { controller, previewUncompletion } = controllerFor(true);

    await controller.uncompletePreflight('match-1', {} as never);

    expect(previewUncompletion).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({ canDiscardDependentResults: true }),
    );
  });

  it('reports the refusal as false, not as a 403', async () => {
    // A pad scorekeeper must still be able to READ what undoing would cost;
    // they just cannot be the one to push it through.
    const { controller, previewUncompletion } = controllerFor(false);

    await expect(controller.uncompletePreflight('match-1', {} as never)).resolves.toBeDefined();
    expect(previewUncompletion).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({ canDiscardDependentResults: false }),
    );
  });
});
