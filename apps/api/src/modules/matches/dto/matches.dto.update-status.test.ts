import { describe, expect, it } from 'vitest';
import { UpdateMatchStatusDto } from './matches.dto';

/**
 * `PATCH /matches/:id/status` writes the status and keeps the fight: the hits, the
 * score and the start time stay (the winner goes, ruling 331). Sent `scheduled`, it left a fought bout that
 * read unplayed, and the doors that ask the owner before they delete fought
 * bouts let it go. A bout goes back to unplayed by a reset only, which clears
 * what was fought (ruling 281).
 */
const schema = UpdateMatchStatusDto.schema;
/** Every case names a winner, so each tests the one field it is about. */
const WINNER = '0d4c7a52-3e1b-4f6a-9c2d-8b5e1f0a7c39';

describe('UpdateMatchStatusDto', () => {
  it('accepts completed with its winner', () => {
    expect(schema.safeParse({ status: 'completed', winnerRegistrationId: WINNER }).success).toBe(
      true,
    );
  });

  // Ruling 1010: a bout completed by hand names its winner; a draw comes from the clock.
  it('refuses completed with no winner', () => {
    const result = schema.safeParse({ status: 'completed' });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['winnerRegistrationId']]);
  });

  // S9: set here, a bout ran with no clock row and no count; the clock puts a bout in play.
  it.each(['running', 'paused'])('refuses %s', (status) => {
    expect(schema.safeParse({ status, winnerRegistrationId: WINNER }).success).toBe(false);
  });

  it('refuses scheduled', () => {
    const result = schema.safeParse({ status: 'scheduled', winnerRegistrationId: WINNER });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['status']]);
  });

  it('refuses voided, which has its own route', () => {
    expect(schema.safeParse({ status: 'voided', winnerRegistrationId: WINNER }).success).toBe(
      false,
    );
  });

  // Ruling 338: the route takes no bout out of completed, so it has nothing to discard.
  it('takes no discard acknowledgement', () => {
    const result = schema.safeParse({
      status: 'completed',
      winnerRegistrationId: WINNER,
      discardDependentResults: true,
    });

    expect(result.success).toBe(false);
  });
});
