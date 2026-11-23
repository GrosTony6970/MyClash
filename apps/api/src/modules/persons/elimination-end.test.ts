import { describe, expect, it } from 'vitest';
import { eliminationEnd, type BracketBout } from './elimination-end';

/**
 * Léa's Longsword bracket (operator, 2026-11-23): she is busy from its start until she is out.
 * She is out once she lost and has nothing left to fight in it; a semi-final loser goes on to
 * the bronze match, written into it the moment the result is saved.
 */
const bout = (over: Partial<BracketBout>): BracketBout => ({
  status: 'completed',
  outcome: 'win',
  scheduledAt: '2027-05-22T14:00:00.000Z',
  durationMinutes: 10,
  fallbackEndsAt: null,
  ...over,
});

describe('when a bracket ends for a fighter', () => {
  it('ends at the planned end of the bout she lost, when nothing is left for her', () => {
    const quarter = bout({ scheduledAt: '2027-05-22T14:00:00.000Z' });
    const semi = bout({ scheduledAt: '2027-05-22T15:00:00.000Z', outcome: 'loss' });
    expect(eliminationEnd([quarter, semi])).toBe('2027-05-22T15:10:00.000Z');
  });

  it('does not end while a bout of hers is still to fight: the bronze match after a semi-final', () => {
    const semi = bout({ outcome: 'loss' });
    const bronze = bout({
      scheduledAt: '2027-05-22T16:00:00.000Z',
      status: 'scheduled',
      outcome: null,
    });
    expect(eliminationEnd([semi, bronze])).toBeNull();
  });

  it.each(['running', 'paused'])('does not end while a bout of hers is %s', (status) => {
    expect(eliminationEnd([bout({ outcome: 'loss' }), bout({ status, outcome: null })])).toBeNull();
  });

  it('does not end while she has lost nothing', () => {
    expect(
      eliminationEnd([bout({}), bout({ scheduledAt: '2027-05-22T15:00:00.000Z' })]),
    ).toBeNull();
  });

  it('ends at the last loss: a double-elimination fighter loses twice', () => {
    const winners = bout({ outcome: 'loss', scheduledAt: '2027-05-22T14:00:00.000Z' });
    const losers = bout({ outcome: 'loss', scheduledAt: '2027-05-22T16:00:00.000Z' });
    expect(eliminationEnd([losers, winners])).toBe('2027-05-22T16:10:00.000Z');
  });

  it("takes the bout's fallback end when it has no length", () => {
    const lost = bout({
      outcome: 'loss',
      durationMinutes: null,
      fallbackEndsAt: '2027-05-22T14:20:00.000Z',
    });
    expect(eliminationEnd([lost])).toBe('2027-05-22T14:20:00.000Z');
  });

  it('keeps the whole bracket (null) when the lost bout has no known end', () => {
    expect(eliminationEnd([bout({ outcome: 'loss', durationMinutes: null })])).toBeNull();
  });

  it('reads a voided bout as neither a loss nor a bout to fight', () => {
    const voided = bout({ status: 'voided', outcome: null });
    expect(eliminationEnd([voided, bout({ outcome: 'loss' })])).toBe('2027-05-22T14:10:00.000Z');
  });
});
