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

  it('counts a bout that was started and then reset', () => {
    // The whole reason `started_at` is in the predicate. `resetMatch` puts the
    // status back to 'scheduled' but leaves the clock's first start behind, so
    // status alone reads this bout as untouched — and bracket advancement would
    // rewrite a pairing somebody already fought.
    expect(hasBeenFought('scheduled', '2026-05-21T10:00:00.000Z')).toBe(true);
  });

  it('is the case that separates it from scoredMatchesIn', () => {
    // phases.service.ts#scoredMatchesIn answers the narrower question — "is
    // scoring under way" — from status alone, and calls this same bout
    // editable. Both answers are correct for their own question; this test
    // exists so the difference is visible rather than looking like drift.
    const status = 'scheduled';
    const startedAt = '2026-05-21T10:00:00.000Z';

    expect(hasBeenFought(status, startedAt)).toBe(true);
    expect(['running', 'paused', 'completed'].includes(status)).toBe(false);
  });

  it('does not care what a voided bout once did', () => {
    // A voided bout carries `started_at` if it ever ran, and this returns true
    // for it. That is intentional at both call sites: bracket-match-sync filters
    // `status != 'voided'` before asking, and dependentClosure wants a voided
    // child to still count as "do not silently discard".
    expect(hasBeenFought('voided', '2026-05-21T10:00:00.000Z')).toBe(true);
  });
});
