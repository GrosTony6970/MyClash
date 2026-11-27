import { describe, expect, it, vi } from 'vitest';
import * as types from '@myclash/types';
import { isWonVenue } from './venues-won';

/**
 * Who a hit won a venue for is the rules' answer (`exchangeDeltas`), not a second statement of
 * the rule here: the pad's tally and the server's count must not drift apart.
 */
vi.mock('@myclash/types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@myclash/types')>();
  return { ...actual, exchangeDeltas: vi.fn(actual.exchangeDeltas) };
});

describe('isWonVenue asks the rules', () => {
  it('passes the row’s scoring side as the striker', () => {
    const row = { type: 'clean' as const, voided: false, scoringSide: 'blue' as const };

    expect(isWonVenue(row)).toBe(true);
    expect(types.exchangeDeltas).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'clean', firstStrikerColor: 'blue' }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('follows the rules’ answer', () => {
    vi.mocked(types.exchangeDeltas).mockReturnValueOnce({ red: 0, blue: 0, venue: null });

    expect(isWonVenue({ type: 'clean', voided: false, scoringSide: 'red' })).toBe(false);
  });
});
