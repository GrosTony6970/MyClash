import { describe, it, expect } from 'vitest';
import { emptySectionMessageKey } from './empty-section-message-key';

describe('emptySectionMessageKey', () => {
  it('returns the generic-empty key when the search is empty', () => {
    expect(emptySectionMessageKey('live', '')).toBe('publicApp.home.emptyLive');
    expect(emptySectionMessageKey('upcoming', '')).toBe('publicApp.home.emptyUpcoming');
    expect(emptySectionMessageKey('past', '')).toBe('publicApp.home.emptyPast');
  });

  it('returns the no-match key when the query is non-empty after trim', () => {
    expect(emptySectionMessageKey('live', 'lyon')).toBe('publicApp.home.emptyLiveNoMatch');
    expect(emptySectionMessageKey('upcoming', '  paris  ')).toBe(
      'publicApp.home.emptyUpcomingNoMatch',
    );
    expect(emptySectionMessageKey('past', 'a')).toBe('publicApp.home.emptyPastNoMatch');
  });

  it('treats whitespace-only queries as empty (returns generic key)', () => {
    expect(emptySectionMessageKey('live', '   ')).toBe('publicApp.home.emptyLive');
    expect(emptySectionMessageKey('upcoming', '\t\n')).toBe('publicApp.home.emptyUpcoming');
  });
});
