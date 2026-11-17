import { describe, expect, it } from 'vitest';
import type { PenaltyRulesetEntry } from '../hooks/usePenalties';
import {
  protestOffer,
  protestsSeen,
  protestsShown,
  protestThenOffer,
  protestWritten,
} from './protest-offer';

/**
 * An entry as the API sends it: `ref_number` is TEXT since migration 0071, so
 * it arrives as a string whatever the pad's type says.
 */
const entry = (id: string, ref: string, name: string): PenaltyRulesetEntry => ({
  id,
  group_number: 8,
  ref_number: ref as unknown as number,
  short_name: name,
  description: `${name}, in full`,
  sanctions: ['red'],
});
const ABUSE = entry('entry-8', '8', 'Contestation abusive');
const ENTRIES = [entry('entry-1', '1', 'Late on guard'), ABUSE, entry('entry-r7a', 'R7a', 'Rude')];

const offer = (over: Partial<Parameters<typeof protestOffer>[0]>) =>
  protestOffer({
    countAfterTap: 3,
    limit: 2,
    offerPenaltyRef: '8',
    entries: ENTRIES,
    cardEntryLive: true,
    ...over,
  });

describe('protestOffer', () => {
  it('offers nothing at the limit, and the penalty past it, every time', () => {
    expect(offer({ countAfterTap: 2 })).toBeNull();
    expect(offer({ countAfterTap: 3 })).toBe(ABUSE);
    expect(offer({ countAfterTap: 4 })).toBe(ABUSE);
  });

  it('offers at every protest when the limit is 0', () => {
    expect(offer({ countAfterTap: 1, limit: 0 })).toBe(ABUSE);
  });

  it('offers nothing with no limit', () => {
    expect(offer({ countAfterTap: 9, limit: null })).toBeNull();
  });

  it('offers nothing when the organiser chose no penalty', () => {
    expect(offer({ offerPenaltyRef: null })).toBeNull();
  });

  it('finds a ref that is not a number', () => {
    expect(offer({ offerPenaltyRef: 'R7a' })?.id).toBe('entry-r7a');
  });

  it('offers nothing when the chosen penalty is not in the list', () => {
    expect(offer({ offerPenaltyRef: '99' })).toBeNull();
  });

  it('offers nothing when the pad takes no card now', () => {
    expect(offer({ cardEntryLive: false })).toBeNull();
  });
});

describe('protestThenOffer', () => {
  /** A tap that writes the next of `uuids` each time, as the queue does. */
  const tapsWriting = (...uuids: Array<string | null>) => {
    const queue = [...uuids];
    return () => Promise.resolve(queue.shift() ?? null);
  };
  const RULES = { limit: 2, offerPenaltyRef: '8', entries: ENTRIES, cardEntryLive: true };

  it('two quick taps with no draw between them: the second, at 3 of 2, offers', async () => {
    // The chip shows 1 and the screen does not draw again before the second tap.
    const seen = protestsSeen();
    protestsShown(seen, new Set(['p-0']));
    const tap = tapsWriting('p-1', 'p-2');

    expect(await protestThenOffer({ tap, seen, ...RULES })).toBeNull();
    expect(await protestThenOffer({ tap, seen, ...RULES })).toBe(ABUSE);
  });

  it('counts a written protest once when the screen draws it', async () => {
    const seen = protestsSeen();
    protestsShown(seen, new Set(['p-0']));
    await protestThenOffer({ tap: tapsWriting('p-1'), seen, ...RULES });
    protestsShown(seen, new Set(['p-0', 'p-1']));

    // The third protest, not the fourth: p-1 is counted by the draw only.
    expect(protestWritten(seen, 'p-2')).toBe(3);
  });

  it('a protest undone after the screen drew it is out of the count', async () => {
    const seen = protestsSeen();
    protestsShown(seen, new Set(['p-0', 'p-1']));
    protestsShown(seen, new Set(['p-0']));

    expect(protestWritten(seen, 'p-2')).toBe(2);
  });

  it('a tap ignored as a double tap offers nothing', async () => {
    const seen = protestsSeen();
    protestsShown(seen, new Set(['p-0', 'p-1', 'p-2']));

    expect(await protestThenOffer({ tap: tapsWriting(null), seen, ...RULES })).toBeNull();
    expect(seen.unseen.size).toBe(0);
  });
});
