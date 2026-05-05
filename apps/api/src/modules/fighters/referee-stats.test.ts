import { describe, expect, it } from 'vitest';
import { buildRefereeStats } from './referee-stats';

describe('buildRefereeStats', () => {
  it('counts referee matches, roles, average time, cards credited to declarant, and buddies', () => {
    const stats = buildRefereeStats({
      userId: 'user-ref',
      assignments: [
        {
          matchId: 'match-1',
          userId: 'user-ref',
          role: 'arbitre_declarant',
          eventName: 'FAL 2026',
          tournamentName: 'Longsword Open',
          weapon: 'Longsword',
          scheduledAt: '2026-03-01T10:00:00Z',
        },
        { matchId: 'match-1', userId: 'buddy-1', role: 'arbitre_assesseur' },
        { matchId: 'match-1', userId: 'buddy-2', role: 'arbitre_table' },
        { matchId: 'match-2', userId: 'user-ref', role: 'arbitre_table' },
        { matchId: 'match-2', userId: 'buddy-1', role: 'arbitre_declarant' },
      ],
      durations: [
        { matchId: 'match-1', durationActiveMs: 120_000 },
        { matchId: 'match-2', durationActiveMs: 180_000 },
      ],
      penalties: [
        { matchId: 'match-1', card: 'yellow', voided: false },
        { matchId: 'match-1', card: 'red', voided: false },
        { matchId: 'match-1', card: 'black', voided: true },
        { matchId: 'match-2', card: 'black', voided: false },
      ],
      buddiesByUserId: {
        'buddy-1': { userId: 'buddy-1', displayName: 'Main Buddy' },
        'buddy-2': { userId: 'buddy-2', displayName: 'Table Buddy' },
      },
      includePrivateDetails: true,
    });

    expect(stats.totalMatches).toBe(2);
    expect(stats.roles).toEqual({
      arbitre_declarant: 1,
      arbitre_assesseur: 0,
      arbitre_table: 1,
    });
    expect(stats.averageRefereeTimeMs).toBe(150_000);
    expect(stats.cards).toEqual({ yellow: 1, red: 1, black: 0 });
    expect(stats.bestBuddies[0]).toEqual({
      userId: 'buddy-1',
      displayName: 'Main Buddy',
      matchesTogether: 2,
    });
    expect(stats.history).toEqual([
      expect.objectContaining({ matchId: 'match-1', role: 'arbitre_declarant' }),
      expect.objectContaining({ matchId: 'match-2', role: 'arbitre_table' }),
    ]);
  });

  it('replays match events when duration is not materialized', () => {
    const stats = buildRefereeStats({
      userId: 'user-ref',
      assignments: [{ matchId: 'match-1', userId: 'user-ref', role: 'arbitre_assesseur' }],
      durations: [
        {
          matchId: 'match-1',
          durationActiveMs: null,
          events: [
            { type: 'start', occurredAt: '2026-03-01T10:00:00.000Z' },
            { type: 'halt', occurredAt: '2026-03-01T10:01:00.000Z' },
            { type: 'adjust_time', occurredAt: '2026-03-01T10:01:01.000Z', adjustmentMs: 5_000 },
            { type: 'resume', occurredAt: '2026-03-01T10:02:00.000Z' },
            { type: 'end', occurredAt: '2026-03-01T10:03:00.000Z' },
          ],
        },
      ],
      penalties: [],
    });

    expect(stats.averageRefereeTimeMs).toBe(125_000);
  });
});
