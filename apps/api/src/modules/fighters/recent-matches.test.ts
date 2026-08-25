import { describe, it, expect } from 'vitest';
import { buildProfileRecentMatch, type RecentMatchRow } from './recent-matches';

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
