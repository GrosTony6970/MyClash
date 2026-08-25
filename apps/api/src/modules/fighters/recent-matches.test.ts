import { describe, it, expect } from 'vitest';
import { buildProfileRecentMatch, deriveMatchOutcome, type RecentMatchRow } from './recent-matches';

describe('deriveMatchOutcome', () => {
  it('honours an explicit winner over the score', () => {
    // Won despite the lower score, lost despite the higher score.
    expect(deriveMatchOutcome(3, 5, 'reg-me', 'reg-me')).toBe('win');
    expect(deriveMatchOutcome(5, 3, 'reg-opp', 'reg-me')).toBe('loss');
  });

  it('falls back to the score when no winner is recorded', () => {
    expect(deriveMatchOutcome(5, 3, null, 'reg-me')).toBe('win');
    expect(deriveMatchOutcome(3, 5, null, 'reg-me')).toBe('loss');
    expect(deriveMatchOutcome(4, 4, null, 'reg-me')).toBe('draw');
  });

  it('calls the doubles ceiling a LOSS, whichever side the fighter is on', () => {
    // 0-0 with no winner is indistinguishable from a draw by both tests above,
    // so the reason has to be read first. Both fighters lost this bout.
    expect(deriveMatchOutcome(0, 0, null, 'reg-me', 'max_doubles')).toBe('loss');
    expect(deriveMatchOutcome(0, 0, null, 'reg-opp', 'max_doubles')).toBe('loss');
  });

  it('leaves the other two ceiling reasons to the winner and the score', () => {
    // 'max_doubles_draw' IS a draw; 'max_doubles_result_stands' has a winner.
    expect(deriveMatchOutcome(0, 0, null, 'reg-me', 'max_doubles_draw')).toBe('draw');
    expect(deriveMatchOutcome(2, 0, 'reg-me', 'reg-me', 'max_doubles_result_stands')).toBe('win');
  });
});

describe('buildProfileRecentMatch', () => {
  const base: RecentMatchRow = {
    id: 'm1',
    status: 'completed',
    scheduledAt: '2026-05-01T10:00:00Z',
    matchNumberLabel: 'P1-3',
    redRegistrationId: 'me',
    blueRegistrationId: 'opp',
    winnerRegistrationId: null,
    endReason: null,
    redScore: 5,
    blueScore: 4,
    eventName: 'Fosse aux Lions',
    eventSlug: 'fosse-aux-lions',
  };
  const own = new Set(['me']);
  const names = new Map([['opp', 'Jane Doe']]);

  it('marks the fighter on red, resolves the opponent, and wins by score', () => {
    const r = buildProfileRecentMatch(base, own, names);
    expect(r.isRed).toBe(true);
    expect(r.opponentName).toBe('Jane Doe');
    expect(r.outcome).toBe('win');
    expect(r.matchNumberLabel).toBe('P1-3');
    expect(r.eventSlug).toBe('fosse-aux-lions');
  });

  it('handles the fighter on blue (isRed=false) and a draw by score', () => {
    const r = buildProfileRecentMatch(
      { ...base, redRegistrationId: 'opp', blueRegistrationId: 'me', redScore: 4, blueScore: 4 },
      own,
      names,
    );
    expect(r.isRed).toBe(false);
    expect(r.opponentName).toBe('Jane Doe');
    expect(r.outcome).toBe('draw');
  });

  it('honours an explicit winner even when the score is level', () => {
    const r = buildProfileRecentMatch(
      { ...base, redScore: 4, blueScore: 4, winnerRegistrationId: 'me' },
      own,
      names,
    );
    expect(r.outcome).toBe('win');
  });

  it('nulls the opponent name when the opponent registration is unknown', () => {
    const r = buildProfileRecentMatch({ ...base, blueRegistrationId: 'ghost' }, own, names);
    expect(r.opponentName).toBeNull();
  });

  it('defaults a missing match-number label to an empty string', () => {
    const r = buildProfileRecentMatch({ ...base, matchNumberLabel: null }, own, names);
    expect(r.matchNumberLabel).toBe('');
  });
});
