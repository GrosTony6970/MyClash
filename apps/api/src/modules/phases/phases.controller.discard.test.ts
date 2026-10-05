/**
 * What the two bracket doors hand the service about the discard (ruling 285).
 *
 * The service lets fought bouts go only when the discard is said. "Delete
 * bracket" says it in the address (`?discardScoredResults=true`), "Regenerate
 * bracket" in its body. The service is a stub here: what it does with the word
 * is `phases.discard-fought.test.ts`'s.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhasesController } from './phases.controller';

const PHASE = '66666666-6666-4666-8666-666666666666';
const TOURNAMENT = '33333333-3333-4333-8333-333333333333';
const OWNER = 'a0000000-0000-4000-8000-000000000001';

const phases = {
  deleteBracketPhase: vi.fn(() => Promise.resolve()),
  generateBracket: vi.fn(() => Promise.resolve({ phaseId: PHASE })),
};
const supabase = {
  anon: { auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: { id: OWNER } } })) } },
};
const req = { headers: { authorization: 'Bearer token' } };
const controller = new PhasesController(phases as never, supabase as never, {} as never);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('"Delete bracket" and the discard', () => {
  it.each<[string | undefined, boolean]>([
    ['true', true],
    [undefined, false],
    ['false', false],
    ['1', false],
  ])('?discardScoredResults=%s reaches the service as %s', async (said, discard) => {
    await controller.deleteBracket(PHASE, req as never, said);

    expect(phases.deleteBracketPhase.mock.calls).toEqual([[PHASE, OWNER, discard]]);
  });
});

describe('"Regenerate bracket" and the discard', () => {
  it('hands the service the body as sent, with who asked', async () => {
    const dto = { phaseType: 'single_elim', discardScoredResults: true };

    await controller.generateBracket(TOURNAMENT, dto as never, req as never, 'true');

    expect(phases.generateBracket.mock.calls).toEqual([[TOURNAMENT, dto, true, OWNER]]);
  });
});
