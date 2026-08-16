import { describe, expect, it } from 'vitest';
import { hasBeenFought } from './fought-match';

describe('hasBeenFought', () => {
  it.each([
    ['running', null, true],
    ['paused', null, true],
    ['completed', null, true],
    ['scheduled', null, false],
    ['voided', null, false],
  ])('status %s with no start → %s', (status, startedAt, expected) => {
    expect(hasBeenFought(status, startedAt as string | null)).toBe(expected);
  });

  it('counts a scheduled bout that still carries a start time', () => {
    // NO CALL SITE CAN PRODUCE THIS ROW, and the predicate answers it anyway.
    // `started_at` is written only alongside `status='running'` (clock.service)
    // and cleared only alongside `status='scheduled'` (unplayedMatchColumns), so
    // the two never disagree. Kept as defence: the cost of a wrong "no" is a
    // played result discarded in silence. See the note in fought-match.ts.
    expect(hasBeenFought('scheduled', '2026-05-21T10:00:00.000Z')).toBe(true);
  });

  it('is the only case where it outruns scoredMatchesIn', () => {
    // phases.service.ts#scoredMatchesIn reads the same three statuses without
    // the `started_at` disjunct. This row is the entire difference between them
    // — and it is unreachable, so today the two agree everywhere. The questions
    // still differ, which is why they stay apart; see the comment there.
    const status = 'scheduled';
    const startedAt = '2026-05-21T10:00:00.000Z';

    expect(hasBeenFought(status, startedAt)).toBe(true);
    expect(['running', 'paused', 'completed'].includes(status)).toBe(false);
  });

  it('counts a voided bout that once ran, and is never asked about one', () => {
    // A voided bout keeps `started_at` if it ever ran, so this returns true.
    // BOTH call sites exclude voided at the query — `loadSlotMatch` and the
    // matches read inside `dependentClosure` each carry
    // `.not('status', 'eq', 'voided')` — so the branch is unreachable at each.
    // Asserted to pin the answer, not because anything depends on it.
    expect(hasBeenFought('voided', '2026-05-21T10:00:00.000Z')).toBe(true);
  });
});
